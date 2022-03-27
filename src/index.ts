import { Janitor } from "@rbxts/janitor";
import Signal from "./Signal";
import { numberToStorageSpace } from "./Converter";
import { Log } from "./Logger";
import Compression from "./Compression";

const Settings = {
	Servertimeout: 30,
	Clienttimeout: 30,
	AutoCleanup: true,
};

const Players = game.GetService("Players");
const RunService = game.GetService("RunService");
const HttpService = game.GetService("HttpService");

const isServer = RunService.IsServer();

const enum RequestTypes {
	FireServer = "FireServer",
	InvokeServer = "InvokeServer",
	FireClient = "FireClient",
	InvokeClient = "InvokeClient",
	GetChildren = "GetChildren",
	GetTags = "GetTags",
	UpdateTag = "UpdateTag",
}

type RemoteParent = BazirRemote | BazirRemoteContainer<[]> | Instance;

const YieldQueue: { [K: string]: thread | undefined } = {};
const BazirRemotes = new Map<RemoteParent, Array<BazirRemote | BazirRemoteContainer<[]>>>();

export const version = 1;

function setSetting<T extends keyof typeof Settings>(setting: T, value: typeof Settings[T]) {
	assert(Settings[setting] !== undefined, `${setting} isn't a setting`);
	assert(
		typeIs(value, typeOf(Settings[setting])),
		"expected %s got %s".format(typeOf(Settings[setting]), typeOf(value)),
	);
	Settings[setting] = value;
}

function setSettings(settings: {
	[K in keyof typeof Settings]?: typeof Settings[K];
}) {
	assert(typeIs(settings, "table"), "expected table got %s".format(typeOf(settings)));
	for (const [setting, value] of pairs(settings)) {
		setSetting(setting, value);
	}
}
export class BazirRemote {
	public Janitor = new Janitor();
	public Childrens = new Array<BazirRemote | BazirRemoteContainer<[]>>();
	private Tags = new Map<string, unknown>();
	public static Is(object: unknown): object is typeof BazirRemote.prototype {
		return typeIs(object, "table") && getmetatable(object) === BazirRemote;
	}
	OnServerInvoke?: (player: Player, ...args: unknown[]) => unknown;
	OnClientInvoke?: (...args: unknown[]) => unknown;
	OnServerEvent = this.Janitor.Add(new Signal<(player: Player, ...args: unknown[]) => void>());
	OnClientEvent = this.Janitor.Add(new Signal<(...args: unknown[]) => void>());
	RemoteEvent!: RemoteEvent<
		(Request: typeof RequestTypes[keyof typeof RequestTypes], uuid: string, ...args: unknown[]) => void
	>;
	private _parent?: RemoteParent;
	Parent?: RemoteParent;
	InvokeClient<T>(player: Player, ...args: unknown[]) {
		assert(isServer, "can only be called from the server");
		const uuid = HttpService.GenerateGUID(false);
		const returnPromise = new Promise<T>((resolve, reject) => {
			YieldQueue[uuid] = coroutine.running();
			this.RemoteEvent.FireClient(
				player,
				RequestTypes.InvokeClient,
				uuid,
				Compression.compress(HttpService.JSONEncode(args)),
			);
			const thread = coroutine.yield()[0] as LuaTuple<[false, string] | [true, unknown[]]>;
			if (!thread[0]) {
				return reject(thread[1]);
			}
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			//@ts-ignore
			resolve(...thread[1]);
		});
		returnPromise.finally(() => {
			YieldQueue[uuid] = undefined;
		});
		return returnPromise.timeout(Settings.Clienttimeout);
	}
	InvokeServer<T>(...args: unknown[]) {
		assert(!isServer, "can only be called from the client");
		const uuid = HttpService.GenerateGUID(false);
		const returnPromise = new Promise<T>((resolve, reject) => {
			YieldQueue[uuid] = coroutine.running();
			this.RemoteEvent.FireServer(
				RequestTypes.InvokeServer,
				uuid,
				Compression.compress(HttpService.JSONEncode(args)),
			);
			const thread = coroutine.yield()[0] as LuaTuple<[false, string] | [true, unknown[]]>;
			if (!thread[0]) {
				return reject(thread[1]);
			}
			// eslint-disable-next-line @typescript-eslint/ban-ts-comment
			//@ts-ignore
			resolve(...thread[1]);
		});
		returnPromise.finally(() => {
			YieldQueue[uuid] = undefined;
		});
		return returnPromise.timeout(Settings.Servertimeout);
	}
	_GetChildren() {
		let returnPromise: Promise<
			{
				RemoteType: "BazirRemote" | "BazirRemoteContainer";
				Path: string;
			}[]
		>; //Promise<typeof BazirRemote.prototype.RemoteEvent[]>
		if (isServer) {
			returnPromise = new Promise<
				{
					RemoteType: "BazirRemote" | "BazirRemoteContainer";
					Path: string;
				}[]
			>((resolve) => {
				resolve(
					this.GetChildren().map((child) => {
						return {
							RemoteType: BazirRemote.Is(child) ? "BazirRemote" : "BazirRemoteContainer",
							Path: child.Path,
						};
					}),
				);
			});
		} else {
			const uuid = HttpService.GenerateGUID(false);
			returnPromise = new Promise<
				{
					RemoteType: "BazirRemote" | "BazirRemoteContainer";
					Path: string;
				}[]
			>((resolve, reject) => {
				YieldQueue[uuid] = coroutine.running();
				this.RemoteEvent.FireServer(RequestTypes.GetChildren, uuid);
				const thread = coroutine.yield()[0] as LuaTuple<[false, string] | [true, unknown[]]>;
				if (!thread[0]) {
					return reject(thread[1]);
				}
				// eslint-disable-next-line @typescript-eslint/ban-ts-comment
				//@ts-ignore
				resolve(...thread[1]);
			});
			returnPromise.finally(() => {
				YieldQueue[uuid] = undefined;
			});
		}
		return returnPromise.timeout(Settings.Servertimeout);
	}
	GetChildren() {
		return this.Childrens;
	}
	FireAllClients(...args: unknown[]) {
		assert(isServer, "can only be called from the server");
		return this.RemoteEvent.FireAllClients(
			RequestTypes.FireClient,
			HttpService.GenerateGUID(false),
			Compression.compress(HttpService.JSONEncode(args)),
		);
	}
	FireClient(player: Player, ...args: unknown[]) {
		assert(isServer, "can only be called from the server");
		assert(typeIs(player, "Instance") && player.IsA("Player"), "expected Player got %s".format(typeOf(player)));
		return this.RemoteEvent.FireClient(
			player,
			RequestTypes.FireClient,
			HttpService.GenerateGUID(false),
			Compression.compress(HttpService.JSONEncode(args)),
		);
	}
	FireClients(players: Player[], ...args: unknown[]) {
		assert(isServer, "can only be called from the server");
		players.forEach((player) => {
			this.FireClient(player, ...args);
		});
	}
	FireOtherClients(ignoreclient: Player[], ...args: unknown[]) {
		assert(isServer, "can only be called from the server");
		return this.FireClients(
			Players.GetPlayers().filter((player) => !ignoreclient.includes(player)),
			...args,
		);
	}
	FireAllClientsWithinDistance(position: Vector3, distance: number, ...args: unknown[]) {
		assert(isServer, "can only be called from the server");
		return this.FireClients(
			Players.GetPlayers().filter((player) => {
				return (
					player.Character &&
					player.Character.PrimaryPart &&
					player.Character.PrimaryPart.Position.sub(position).Magnitude <= distance
				);
			}),
			...args,
		);
	}
	FireOtherClientsWithinDistance(ignoreclient: Player[], position: Vector3, distance: number, ...args: unknown[]) {
		assert(isServer, "can only be called from the server");
		return this.FireClients(
			Players.GetPlayers().filter((player) => {
				return (
					player.Character &&
					player.Character.PrimaryPart &&
					player.Character.PrimaryPart.Position.sub(position).Magnitude <= distance &&
					!ignoreclient.includes(player)
				);
			}),
			...args,
		);
	}
	FireServer(...args: unknown[]) {
		assert(!isServer, "can only be called from the client");
		return this.RemoteEvent.FireServer(
			RequestTypes.FireServer,
			HttpService.GenerateGUID(false),
			Compression.compress(HttpService.JSONEncode(args)),
		);
	}
	SetTag(key: string, value: unknown) {
		assert(typeIs(key, "string"), "expected string got %s".format(typeOf(key)));
		this.Tags.set(key, value);
		if (isServer) {
			this.RemoteEvent.FireAllClients(
				RequestTypes.UpdateTag,
				HttpService.GenerateGUID(false),
				Compression.compress(HttpService.JSONEncode([key, value])),
			);
		}
	}
	GetTag<T>(key: string) {
		assert(typeIs(key, "string"), "expected string got %s".format(typeOf(key)));
		return this.Tags.get(key) as T;
	}
	GetTags<T extends {}>() {
		return this.Tags as unknown as T;
	}
	_getremote(parent: Instance, Path = this.Path) {
		if (this.RemoteEvent) {
			return this.RemoteEvent;
		}
		if (isServer && !parent.FindFirstChild(Path)) {
			BazirRemotes.get(parent)?.push(this);
			this._parent = parent;
			this.RemoteEvent = new Instance("RemoteEvent");
			this.RemoteEvent.Name = Path;
			this.RemoteEvent.Parent = parent;
		}
		this.RemoteEvent =
			this.RemoteEvent ||
			(parent.WaitForChild(
				Path,
				(Settings.Clienttimeout + Settings.Servertimeout) / 2,
			) as typeof BazirRemote.prototype.RemoteEvent);
		assert(this.RemoteEvent !== undefined, "could not find path for %s : %s".format(Path, parent.GetFullName()));
		return this.RemoteEvent;
	}
	_changeparent(parent: unknown, Path = this.Path) {
		if (this._parent === parent) {
			return;
		}
		BazirRemote.AssertParent(parent);
		const remoteuniquepaths = BazirRemotes.get(parent) ?? BazirRemotes.set(parent, []).get(parent)!;
		assert(remoteuniquepaths.find((i) => i.Path === Path) === undefined, "this path is already created");

		if (BazirRemote.Is(parent) || BazirRemoteContainer.Is(parent)) {
			parent._addChildRemote(this);
			return;
		}
		if (this.RemoteEvent) {
			BazirRemotes.get(parent)?.remove(remoteuniquepaths.findIndex((i) => i === this));
			this.RemoteEvent.Parent = parent;
			this._parent = parent;
			return;
		}
		this._getremote(parent, Path);
	}
	_removeChildRemote(child: BazirRemote | BazirRemoteContainer<[]>) {
		this.Childrens.remove(this.Childrens.findIndex((childremote) => childremote === child));
	}
	_addChildRemote(child: BazirRemote | BazirRemoteContainer<[]>): void {
		const lastparent = child._parent;
		BazirRemotes.get(this)?.push(child);
		if (BazirRemote.Is(lastparent) || BazirRemoteContainer.Is(lastparent)) {
			lastparent._removeChildRemote(child);
		}
		child._getremote(this.RemoteEvent).Parent = this.RemoteEvent;
		this.Childrens.push(child);
	}
	static AssertParent(value: unknown): asserts value is RemoteParent {
		assert(
			BazirRemote.Is(value) || BazirRemoteContainer.Is(value) || typeIs(value, "Instance"),
			"parent must be a Instance, BazirRemote or BazirRemoteContainer",
		);
	}
	Destroy() {
		this.Janitor.Destroy();
	}
	constructor(public Path: string, Parent: RemoteParent = script) {
		assert(typeIs(Path, "string"), `expects string, got ${type(Path)}`);
		this._changeparent(Parent, Path);
		this.Janitor.Add(this.RemoteEvent);
		if (isServer) {
			this.RemoteEvent.OnServerEvent.Connect((player, Request, uuid, data) => {
				const args =
					data !== undefined ? (HttpService.JSONDecode(Compression.decompress(data)) as unknown[]) : [];
				//warn(typeIs(data, "string") ? numberToStorageSpace(data.size()) : data)
				Log.Info(
					`Server receive ${numberToStorageSpace(
						`${Request}${uuid}${HttpService.JSONEncode(args)}`.size(),
					)} worth of data.`,
				);
				switch (Request) {
					case RequestTypes.InvokeServer: {
						this.RemoteEvent.FireClient(
							player,
							Request,
							uuid as string,
							Compression.compress(
								HttpService.JSONEncode([
									pcall(() => {
										assert(this.OnServerInvoke !== undefined, `${Path} isn't invoke on server`);
										return [this.OnServerInvoke(player, ...args)];
									}),
								]),
							),
						);
						break;
					}
					case RequestTypes.InvokeClient: {
						const Thread = YieldQueue[uuid as string];
						if (Thread && coroutine.status(Thread) === "suspended") {
							coroutine.resume(Thread, ...args);
						}
						break;
					}
					case RequestTypes.FireServer: {
						this.OnServerEvent.Fire(player, ...args);
						break;
					}
					case RequestTypes.GetChildren: {
						this.RemoteEvent.FireClient(
							player,
							Request,
							uuid as string,
							Compression.compress(
								HttpService.JSONEncode([
									pcall(() => {
										return [this._GetChildren().await()[1]];
									}),
								]),
							),
						);
						break;
					}
					case RequestTypes.GetTags: {
						this.RemoteEvent.FireClient(
							player,
							Request,
							uuid as string,
							Compression.compress(
								HttpService.JSONEncode([
									pcall(() => {
										return [this.Tags];
									}),
								]),
							),
						);
						break;
					}
					default:
						player.Kick();
						break;
				}
			});
		} else {
			this.RemoteEvent.OnClientEvent.Connect((Request, uuid, data) => {
				const args =
					data !== undefined ? (HttpService.JSONDecode(Compression.decompress(data)) as unknown[]) : [];
				//warn(typeIs(data, "string") ? numberToStorageSpace(data.size()) : data)
				/* Log.Info(
                    `Client receive ${numberToStorageSpace(
                        `${Request}${uuid}${HttpService.JSONEncode(args)}`.size(),
                    )} worth of data.`,
                ); */
				switch (Request) {
					case RequestTypes.InvokeServer: {
						const Thread = YieldQueue[uuid];
						if (Thread && coroutine.status(Thread) === "suspended") {
							coroutine.resume(Thread, ...args);
						}
						break;
					}
					case RequestTypes.InvokeClient: {
						this.RemoteEvent.FireServer(
							Request,
							uuid,
							Compression.compress(
								HttpService.JSONEncode([
									pcall(() => {
										assert(this.OnClientInvoke !== undefined, `${Path} isn't invoke on client`);
										return [this.OnClientInvoke(...args)];
									}),
								]),
							),
						);
						break;
					}
					case RequestTypes.FireClient: {
						this.OnClientEvent.Fire(...args);
						break;
					}
					case RequestTypes.GetChildren: {
						const Thread = YieldQueue[uuid];
						if (Thread && coroutine.status(Thread) === "suspended") {
							coroutine.resume(Thread, ...args);
						}
						break;
					}
					case RequestTypes.GetTags: {
						const Thread = YieldQueue[uuid];
						if (Thread && coroutine.status(Thread) === "suspended") {
							coroutine.resume(Thread, ...args);
						}
						break;
					}
					case RequestTypes.UpdateTag: {
						this.Tags.set(...(args as [string, unknown]));
						break;
					}
					default:
						break;
				}
			});
			const Taguuid = HttpService.GenerateGUID(false);
			Promise.all([
				new Promise<typeof BazirRemote.prototype.Tags>((resolve, reject) => {
					YieldQueue[Taguuid] = coroutine.running();
					this.RemoteEvent.FireServer(RequestTypes.GetTags, Taguuid);
					const thread = coroutine.yield()[0] as LuaTuple<[false, string] | [true, unknown[]]>;
					if (!thread[0]) {
						return reject(thread[1]);
					}
					// eslint-disable-next-line @typescript-eslint/ban-ts-comment
					//@ts-ignore
					resolve(...thread[1]);
				})
					.timeout(Settings.Servertimeout)
					.then((value) => {
						this.Tags = value;
					})
					.finally(() => {
						YieldQueue[Taguuid] = undefined;
					}),
				this._GetChildren().then((Remotes) => {
					const _removeChildrens = new Array<Promise<void>>();
					Remotes.forEach(({ RemoteType, Path }) => {
						_removeChildrens.push(
							Promise.try(() => {
								switch (RemoteType) {
									case "BazirRemote": {
										this.Childrens.push(this.Janitor.Add(new BazirRemote(`${Path}`, this)));
										break;
									}
									case "BazirRemoteContainer": {
										this.Childrens.push(
											this.Janitor.Add(new BazirRemoteContainer(`${Path}`, [], this)),
										);
										break;
									}
									default:
										warn(`${RemoteType} isn't supported`);
										break;
								}
							}),
						);
					});
					Promise.all(_removeChildrens).await();
				}),
			]).await();
		}
		const mt = getmetatable(this) as LuaMetatable<BazirRemote>;
		mt.__newindex = (remote, index, value) => {
			switch (index) {
				case "RemoteEvent": {
					assert(remote[index] === undefined, "Cannot change remote event");
					rawset(remote, index, value);
					break;
				}
				/* case "_parent": {
                    rawset(remote, index, value);
                    rawset(remote, "Parent", value);
                } */
				case "Parent": {
					const parent = remote[index];
					if (parent === value) {
						return;
					}
					BazirRemote.AssertParent(value);
					remote._changeparent(value);
					rawset(remote, index, value);
					break;
				}
				default:
					/* warn("BazirRemote", index, value) */
					rawset(remote, index, value);
				/* error("(cannot modify readonly table)") */
			}
		};
	}
}
export class BazirRemoteContainer<T extends string[] = string[]> extends BazirRemote {
	public static Is(object: unknown): object is typeof BazirRemoteContainer.prototype {
		return typeIs(object, "table") && getmetatable(object) === BazirRemoteContainer;
	}
	private Containers = new Array<{
		key: string;
		Remote: BazirRemote | BazirRemoteContainer;
	}>();
	get(key: string) {
		return this.Containers.find((child) => child.key === `${key}`)?.Remote;
	}
	add(key: string) {
		assert(isServer, "Cannot add remote on client");
		const Remote = this.Janitor.Add(new BazirRemote(`${key}`, this));
		this.Containers.push({ key, Remote });
		return Remote;
	}
	constructor(public Path: string, starters: T, parent?: RemoteParent) {
		super(Path, parent);
		if (isServer) {
			starters.forEach((starter) => {
				this.add(starter);
			});
		} else {
			this.GetChildren().forEach((child) => {
				this.Containers.push({ key: child.Path, Remote: child });
			});
		}
	}
}
enum NetworkSettings {
	Name = "_Network_",
	Event = "_Event_",
	Function = "_Function_",
}
type ServerEventsFunction = (player: Player, ...args: unknown[]) => unknown;
type ClientEventsFunction = (...args: unknown[]) => unknown;
export class ServerNetwork {
	private RemoteContainer: BazirRemoteContainer;
	Invoke<T>(key: string, player: Player, ...args: unknown[]): Promise<T> {
		return this.RemoteContainer.get(`${NetworkSettings.Function}`)!.InvokeClient<T>(player, `${key}`, ...args);
	}
	Fire(key: string, player: Player | Player[], ...args: unknown[]) {
		if (typeIs(player, "table")) {
			return this.RemoteContainer.get(`${NetworkSettings.Event}`)!.FireClients(
				player as Player[],
				`${key}`,
				...args,
			);
		}
		return this.RemoteContainer.get(`${NetworkSettings.Event}`)!.FireClient(player, `${key}`, ...args);
	}
	FireAll(key: string, ...args: unknown[]) {
		return this.RemoteContainer.get(`${NetworkSettings.Event}`)!.FireAllClients(`${key}`, ...args);
	}
	FireOther(key: string, ignoreclient: Player[], ...args: unknown[]) {
		return this.RemoteContainer.get(`${NetworkSettings.Event}`)!.FireOtherClients(ignoreclient, `${key}`, ...args);
	}
	FireAllWithinDistance(key: string, position: Vector3, distance: number, ...args: unknown[]) {
		return this.RemoteContainer.get(`${NetworkSettings.Event}`)!.FireAllClientsWithinDistance(
			position,
			distance,
			`${key}`,
			...args,
		);
	}
	FireOtherWithinDistance(
		key: string,
		ignoreclient: Player[],
		position: Vector3,
		distance: number,
		...args: unknown[]
	) {
		return this.RemoteContainer.get(`${NetworkSettings.Event}`)!.FireOtherClientsWithinDistance(
			ignoreclient,
			position,
			distance,
			`${key}`,
			...args,
		);
	}
	BindFunctions(functions: { [k: string]: ServerEventsFunction }) {
		for (const [key, value] of pairs(functions)) {
			this.RemoteContainer.add(`${NetworkSettings.Function}/${key}`).OnServerInvoke = value;
		}
	}
	BindEvents(events: { [k: string]: ServerEventsFunction }) {
		for (const [key, value] of pairs(events)) {
			this.RemoteContainer.add(`${NetworkSettings.Event}/${key}`).OnServerEvent.Connect(value);
		}
	}
	constructor(parent?: RemoteParent) {
		assert(isServer, "Cannot create server network on client");
		this.RemoteContainer = new BazirRemoteContainer(
			NetworkSettings.Name,
			[`${NetworkSettings.Function}`, `${NetworkSettings.Event}`],
			parent,
		);
	}
}
export class ClientNetwork {
	RemoteContainer: BazirRemoteContainer<never[]>;
	public static Is(object: unknown): object is typeof ClientNetwork.prototype {
		return typeIs(object, "table") && getmetatable(object) === ClientNetwork;
	}
	private Comunications = {
		Functions: new Map<string, ClientEventsFunction>(),
		Events: new Map<string, Array<ClientEventsFunction>>(),
	};
	Invoke<T>(key: string, ...args: unknown[]): Promise<T> | undefined {
		return this.RemoteContainer.get(`${NetworkSettings.Function}/${key}`)?.InvokeServer<T>(...args);
	}
	Fire(key: string, ...args: unknown[]) {
		this.RemoteContainer.get(`${NetworkSettings.Event}/${key}`)?.FireServer(...args);
	}
	BindFunctions(functions: { [k: string]: ClientEventsFunction }) {
		for (const [key, value] of pairs(functions)) {
			this.Comunications.Functions.set(`${key}`, value);
		}
	}
	BindEvents(events: { [k: string]: ClientEventsFunction }) {
		for (const [key, value] of pairs(events)) {
			this.Comunications.Events.get(`${key}`)?.push(value);
		}
	}
	constructor(parent?: RemoteParent) {
		assert(!isServer, "Cannot create client network on server");
		this.RemoteContainer = new BazirRemoteContainer(NetworkSettings.Name, [], parent);
		this.RemoteContainer.get(`${NetworkSettings.Event}`)?.OnClientEvent.Connect((key, ...args) => {
			assert(typeIs(key, "string"), "Key must be string");
			const funcs = this.Comunications.Events.get(key);
			if (funcs) {
				funcs.forEach(async (func) => func(...args));
			}
		});
		this.RemoteContainer.get(`${NetworkSettings.Function}`)!.OnClientInvoke = (key, ...args) => {
			assert(typeIs(key, "string"), "Key must be string");
			const func = this.Comunications.Functions.get(key);
			assert(func !== undefined, "Cannot find function");
			return func(...args);
		};
	}
}

if (isServer) {
	game.BindToClose(() => {
		if (Settings.AutoCleanup) {
			for (const [_, Thread] of pairs(YieldQueue)) {
				if (coroutine.status(Thread) === "suspended") {
					coroutine.resume(Thread, [false, "Game Closing"]);
				}
			}
		}
	});
} else {
	Players.LocalPlayer.AncestryChanged.Connect(() => {
		if (Settings.AutoCleanup) {
			for (const [_, Thread] of pairs(YieldQueue)) {
				if (coroutine.status(Thread) === "suspended") {
					coroutine.resume(Thread, [false, "Leaving"]);
				}
			}
		}
	});
}

export default { setSetting, setSettings };
