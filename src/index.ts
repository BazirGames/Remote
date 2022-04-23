import { Janitor } from "@rbxts/janitor";
import Signal from "./Signal";
import Compression from "./Compression";

const LogSettings = {
	LogEnabled: false,
	LogAdvancedEnabled: false,
};
const Log = {
	Info: async (message: string, ...optionalParams: unknown[]) => {
		if (LogSettings.LogEnabled) {
			print(message, optionalParams);
		}
	},
	Error: async (message: string, ...optionalParams: unknown[]) => {
		if (LogSettings.LogEnabled) {
			print(message, optionalParams);
		}
	},
	Debug: async (message: string, ...optionalParams: unknown[]) => {
		if (LogSettings.LogAdvancedEnabled) {
			print(message, optionalParams);
		}
	},
	Warn: async (message: string, ...optionalParams: unknown[]) => {
		warn(message, optionalParams);
	},
};

const Settings = {
	Servertimeout: 30,
	Clienttimeout: 30,
	AutoCleanup: true,
};

const Players = game.GetService("Players");
const RunService = game.GetService("RunService");
const HttpService = game.GetService("HttpService");

const isServer = RunService.IsServer();

const enum BRType {
	Loaded = "_Loaded_",
}

const enum RequestTypes {
	FireServer = "FireServer",
	InvokeServer = "InvokeServer",
	FireClient = "FireClient",
	InvokeClient = "InvokeClient",
	GetChildren = "GetChildren",
	ChildAdded = "ChildAdded",
	ChildRemoved = "ChildRemoved",
	GetTags = "GetTags",
	UpdateTag = "UpdateTag",
}

type Remotes = BazirRemote | BazirRemoteContainer<[]>;
type RemoteParent = Remotes | Instance;
type RemoteNameType = "BazirRemote" | "BazirRemoteContainer";

const YieldQueue: { [K: string]: thread | undefined } = {};
const BazirRemotes = new Map<
	RemoteParent,
	{
		LastParent?: RemoteParent;
		Parent?: RemoteParent;
		Children: Array<Remotes>;
	}
>();

//number toFixed
function toFixedNumber(num: number, digits = 0, base = 10) {
	const pow = math.pow(base, digits);
	return math.round(num * pow) / pow;
}

//number to storage space
function numberToStorageSpace(number: number): string {
	if (number < 1024) {
		return number + "B";
	} else if (number < 1024 * 1024) {
		return toFixedNumber(number / 1024, 2) + "KB";
	} else if (number < 1024 * 1024 * 1024) {
		return toFixedNumber(number / 1024 / 1024, 2) + "MB";
	} else {
		return toFixedNumber(number / 1024 / 1024 / 1024, 2) + "GB";
	}
}

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

function GetRemoteType(remote: Remotes): RemoteNameType {
	if (BazirRemote.Is(remote)) {
		return "BazirRemote";
	} else if (BazirRemoteContainer.Is(remote)) {
		return "BazirRemoteContainer";
	}
	error("Unknown remote type");
}

function IsRemote(remote: unknown): remote is BazirRemote | BazirRemoteContainer<[]> {
	return BazirRemote.Is(remote) || BazirRemoteContainer.Is(remote);
}
export class BazirRemote {
	public Janitor = new Janitor();
	private Tags = new Map<string, unknown>();
	public static Is(object: unknown): object is typeof BazirRemote.prototype {
		return typeIs(object, "table") && getmetatable(object) === BazirRemote;
	}
	public static AssertParent(value: unknown): asserts value is RemoteParent {
		assert(
			BazirRemote.Is(value) || BazirRemoteContainer.Is(value) || typeIs(value, "Instance"),
			"parent must be a Instance, BazirRemote or BazirRemoteContainer",
		);
	}
	public OnServerInvoke?: (player: Player, ...args: unknown[]) => unknown;
	public OnClientInvoke?: (...args: unknown[]) => unknown;
	public OnServerEvent = this.Janitor.Add(new Signal<(player: Player, ...args: unknown[]) => void>());
	public OnClientEvent = this.Janitor.Add(new Signal<(...args: unknown[]) => void>());
	public ChildAdded = this.Janitor.Add(new Signal<(Child: BazirRemote) => void>());
	public ChildRemoved = this.Janitor.Add(new Signal<(Child: BazirRemote) => void>());
	private RemoteEvent!: RemoteEvent<
		(Request: typeof RequestTypes[keyof typeof RequestTypes], uuid: string, ...args: unknown[]) => void
	>;
	public Parent!: RemoteParent;
	public InvokeClient<T>(player: Player, ...args: unknown[]) {
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
	public InvokeServer<T>(...args: unknown[]) {
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
	/** @hidden */
	public _GetChildren() {
		let returnPromise: Promise<
			{
				RemoteType: RemoteNameType;
				Path: string;
			}[]
		>; //Promise<typeof BazirRemote.prototype.RemoteEvent[]>
		if (isServer) {
			returnPromise = new Promise<
				{
					RemoteType: RemoteNameType;
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
					RemoteType: RemoteNameType;
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
	public GetChildren() {
		return BazirRemotes.get(this)?.Children ?? [];
	}
	public FireAllClients(...args: unknown[]) {
		assert(isServer, "can only be called from the server");
		return this.RemoteEvent.FireAllClients(
			RequestTypes.FireClient,
			HttpService.GenerateGUID(false),
			Compression.compress(HttpService.JSONEncode(args)),
		);
	}
	public FireClient(player: Player, ...args: unknown[]) {
		assert(isServer, "can only be called from the server");
		assert(typeIs(player, "Instance") && player.IsA("Player"), "expected Player got %s".format(typeOf(player)));
		return this.RemoteEvent.FireClient(
			player,
			RequestTypes.FireClient,
			HttpService.GenerateGUID(false),
			Compression.compress(HttpService.JSONEncode(args)),
		);
	}
	public FireClients(players: Player[], ...args: unknown[]) {
		assert(isServer, "can only be called from the server");
		players.forEach((player) => {
			this.FireClient(player, ...args);
		});
	}
	public FireOtherClients(ignoreclient: Player[], ...args: unknown[]) {
		assert(isServer, "can only be called from the server");
		return this.FireClients(
			Players.GetPlayers().filter((player) => !ignoreclient.includes(player)),
			...args,
		);
	}
	public FireAllClientsWithinDistance(position: Vector3, distance: number, ...args: unknown[]) {
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
	public FireOtherClientsWithinDistance(
		ignoreclient: Player[],
		position: Vector3,
		distance: number,
		...args: unknown[]
	) {
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
	public FireServer(...args: unknown[]) {
		assert(!isServer, "can only be called from the client");
		return this.RemoteEvent.FireServer(
			RequestTypes.FireServer,
			HttpService.GenerateGUID(false),
			Compression.compress(HttpService.JSONEncode(args)),
		);
	}
	public SetTag(key: string, value: unknown) {
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
	public GetTag<T>(key: string) {
		assert(typeIs(key, "string"), "expected string got %s".format(typeOf(key)));
		return this.Tags.get(key) as T;
	}
	public GetTags<T extends {}>() {
		return this.Tags as unknown as T;
	}
	/** @hidden */
	public _getRemoteParent(): Instance {
		return typeIs(this.Parent, "Instance") ? this.Parent : this.Parent!._GetorCreateRemote();
	}
	/** @hidden */
	public _createRemote(parent = this._getRemoteParent()): typeof BazirRemote.prototype.RemoteEvent {
		assert(isServer, "can only be called from the server");
		let RemoteEvent =
			this.RemoteEvent ?? (parent.FindFirstChild(this.Path) as typeof BazirRemote.prototype.RemoteEvent);
		if (isServer && !RemoteEvent) {
			RemoteEvent = this.Janitor.Add(new Instance("RemoteEvent"));
			RemoteEvent.Name = this.Path;
			RemoteEvent.Parent = parent;
		}
		this.RemoteEvent = RemoteEvent;
		return RemoteEvent;
	}
	/** @hidden */
	public _getRemote(
		timeout = (Settings.Clienttimeout + Settings.Servertimeout) / 2,
	): typeof BazirRemote.prototype.RemoteEvent | undefined {
		const ParentRemoteEvent = this._getRemoteParent();
		const FoundRemote = ParentRemoteEvent?.FindFirstChild(this.Path) as RemoteEvent | undefined;
		return (
			this.RemoteEvent ??
			FoundRemote ??
			((timeout <= 0
				? FoundRemote
				: ParentRemoteEvent?.WaitForChild(this.Path, timeout)) as typeof BazirRemote.prototype.RemoteEvent)
		);
	}
	/** @hidden */
	public _GetorCreateRemote(parent?: Instance): typeof BazirRemote.prototype.RemoteEvent {
		return this._getRemote(isServer ? 0 : undefined) ?? this._createRemote(parent);
	}
	/** @hidden */
	public _updateremoteparent(parent: Instance) {
		print("_updateremoteparent", parent);
		const RemoteEvent = this._GetorCreateRemote();
		if (isServer) {
			RemoteEvent.Parent = parent;
		}
	}
	/** @hidden */
	public _changeparent(parent: unknown) {
		print("_changeparent", parent);
		BazirRemote.AssertParent(parent);
		const CurrentData =
			BazirRemotes.get(this) ??
			BazirRemotes.set(this, {
				Children: [],
			}).get(this)!;
		if (CurrentData?.Parent === parent) {
			return;
		}
		const ParentData =
			BazirRemotes.get(parent) ??
			BazirRemotes.set(parent, {
				Children: [],
			}).get(parent)!;
		assert(ParentData.Children.find((i) => i.Path === this.Path) === undefined, "this path is already created");
		ParentData.Children.push(this);
		CurrentData.LastParent = CurrentData.Parent;
		CurrentData.Parent = parent;
		rawset(this, "Parent", parent);
		if (BazirRemote.Is(parent) || BazirRemoteContainer.Is(parent)) {
			parent._addChildRemote(this);
			return;
		}
		this._updateremoteparent(parent);
	}
	/** @hidden */
	public _removeChildRemote(child: Remotes) {
		this.ChildRemoved.Fire(child);
		if (isServer) {
			this.RemoteEvent.FireAllClients(
				RequestTypes.ChildRemoved,
				HttpService.GenerateGUID(false),
				Compression.compress(
					HttpService.JSONEncode([
						{
							RemoteType: GetRemoteType(child),
							Path: child.Path,
						},
					]),
				),
			);
		}
	}
	/** @hidden */
	public _addChildRemote(child: Remotes): void {
		const CurrentData = BazirRemotes.get(this);
		if (BazirRemote.Is(CurrentData?.LastParent) || BazirRemoteContainer.Is(CurrentData?.LastParent)) {
			CurrentData.LastParent._removeChildRemote(child);
		}
		child._updateremoteparent(this.RemoteEvent);
		if (isServer) {
			this.RemoteEvent.FireAllClients(
				RequestTypes.ChildAdded,
				HttpService.GenerateGUID(false),
				Compression.compress(
					HttpService.JSONEncode([
						{
							RemoteType: GetRemoteType(child),
							Path: child.Path,
						},
					]),
				),
			);
		}
		this.ChildAdded.Fire(child);
	}
	private _removeChild(RemoteType: RemoteNameType, Path: string) {
		const CurrentData = BazirRemotes.get(this);
		if (!CurrentData) {
			return;
		}
		CurrentData.Children.remove(
			CurrentData.Children.findIndex((child) => GetRemoteType(child) === RemoteType && child.Path === Path),
		)?.Destroy();
	}
	private _createChild(RemoteType: RemoteNameType, Path: string) {
		switch (RemoteType) {
			case "BazirRemote": {
				this.Janitor.Add(new BazirRemote(`${Path}`, this));
				break;
			}
			case "BazirRemoteContainer": {
				this.Janitor.Add(new BazirRemoteContainer(`${Path}`, [], this));
				break;
			}
			default:
				warn(`${RemoteType} isn't supported`);
				break;
		}
	}
	public Destroy() {
		const CurrentData = BazirRemotes.get(this);
		if (CurrentData) {
			if (CurrentData?.Parent) {
				const ParrentData = BazirRemotes.get(CurrentData.Parent);
				if (IsRemote(CurrentData.Parent)) {
					CurrentData.Parent._removeChildRemote(this);
				}
				if (ParrentData) {
					ParrentData.Children.remove(ParrentData.Children.indexOf(this));
					if (typeIs(CurrentData.Parent, "Instance") && ParrentData.Children.size() === 0) {
						BazirRemotes.delete(CurrentData.Parent);
					}
				}
				CurrentData.Parent = undefined;
			}
			CurrentData.Children.forEach((child) => {
				child.Destroy();
			});
			CurrentData.Children.clear();
			BazirRemotes.delete(this);
		}
		this.Janitor.Destroy();
		//table.clear(this);
		//setmetatable<BazirRemote>(this, undefined as unknown as LuaMetatable<BazirRemote>);
	}
	constructor(public Path: string, Parent: RemoteParent = script) {
		BazirRemote.AssertParent(parent);
		const mt = getmetatable(this) as LuaMetatable<BazirRemote>;
		mt.__newindex = (remote, index, value) => {
			warn(`[BazirRemote] ${this.Path} can't set ${index}`);
			print(index, value, debug.traceback());
			switch (index) {
				case "RemoteEvent": {
					assert(remote[index] === undefined, "Cannot change remote event");
					rawset(remote, index, value);
					break;
				}
				case "Parent": {
					remote._changeparent(value);
					break;
				}
				case "OnServerInvoke": {
					/* assert(remote[index] === undefined, "Cannot change on server invoke"); */
					assert(typeOf(value) === "function", "On server invoke must be function");
					assert(isServer, "On server invoke can be set only on server");
					rawset(remote, index, value);
					break;
				}
				case "OnClientInvoke": {
					/* assert(remote[index] === undefined, "Cannot change on client invoke"); */
					assert(typeOf(value) === "function", "On client invoke must be function");
					assert(!isServer, "On client invoke can be set only on client");
					rawset(remote, index, value);
					break;
				}
				default:
					assert(rawget(mt, BRType.Loaded) !== true, "(cannot modify readonly [BazirRemote])");
					rawset(remote, index, value);
			}
		};
		assert(typeIs(Path, "string"), `expects string, got ${type(Path)}`);
		assert(Path.size() > 0, "path can't be empty");
		assert(Path.size() < 256, "path can't be longer than 255 characters");
		this.RemoteEvent = this._GetorCreateRemote(Parent);
		this._changeparent(Parent);
		assert(this.RemoteEvent !== undefined, "failed to create remote event");
		if (isServer) {
			this.Janitor.Add(
				this.RemoteEvent.OnServerEvent.Connect((player, Request, uuid, data) => {
					const args =
						data !== undefined ? (HttpService.JSONDecode(Compression.decompress(data)) as unknown[]) : [];
					Log.Info(
						`[Server] - [${player.Name}] > ${numberToStorageSpace(
							`${Request}${uuid}${HttpService.JSONEncode(args)}`.size(),
						)} - ${Request} - ${uuid} => ${(args as (keyof CheckablePrimitives)[])
							.map((arg) => type(arg))
							.join(", ")}`,
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
							player.Kick("Invalid Request");
							break;
					}
				}),
			);
		} else {
			this.Janitor.Add(
				this.RemoteEvent.OnClientEvent.Connect((Request, uuid, data) => {
					const args =
						data !== undefined ? (HttpService.JSONDecode(Compression.decompress(data)) as unknown[]) : [];
					Log.Info(
						`[Client] - [localplayer] > ${numberToStorageSpace(
							`${Request}${uuid}${HttpService.JSONEncode(args)}`.size(),
						)} - ${Request} - ${uuid} => ${(args as (keyof CheckablePrimitives)[])
							.map((arg) => type(arg))
							.join(", ")}`,
					);
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
						case RequestTypes.ChildRemoved: {
							assert(typeOf(args) === "table", "ChildRemoved args isn't table");
							assert(args.size() === 1, "ChildRemoved args data length isn't 1");
							const Child = args[0];
							assert(typeOf(Child) === "table", `Child must be table`);
							const { RemoteType, Path } = Child as {
								RemoteType: RemoteNameType;
								Path: string;
							};
							assert(typeOf(RemoteType) === "string", `RemoteType must be string`);
							assert(typeOf(Path) === "string", `Path must be string`);
							this._removeChild(RemoteType, Path);
							break;
						}
						case RequestTypes.ChildAdded: {
							assert(typeOf(args) === "table", "ChildRemoved args isn't table");
							assert(args.size() === 1, "ChildAdded args data length isn't 1");
							const Child = args[0];
							assert(typeOf(Child) === "table", `Child must be table`);
							const { RemoteType, Path } = Child as {
								RemoteType: RemoteNameType;
								Path: string;
							};
							assert(typeOf(RemoteType) === "string", `RemoteType must be string`);
							assert(typeOf(Path) === "string", `Path must be string`);
							this._createChild(RemoteType, Path);
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
				}),
			);
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
						_removeChildrens.push(Promise.try(() => this._createChild(RemoteType, Path)));
					});
					Promise.all(_removeChildrens).await();
				}),
			]).await();
		}
		rawset(this, BRType.Loaded, true);
	}
}
export class BazirRemoteContainer<T extends string[] = string[]> extends BazirRemote {
	public static Is(object: unknown): object is typeof BazirRemoteContainer.prototype {
		return typeIs(object, "table") && getmetatable(object) === BazirRemoteContainer;
	}
	private Containers = new Array<{
		key: string;
		Remote: Remotes;
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

const enum NetworkSettings {
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
		const Remote = this.RemoteContainer.get(`${NetworkSettings.Function}`)!;
		for (const [key, value] of pairs(functions)) {
			new BazirRemote(`${key}`, Remote).OnServerInvoke = value;
		}
		return this;
	}
	BindEvents(events: { [k: string]: ServerEventsFunction }) {
		const Remote = this.RemoteContainer.get(`${NetworkSettings.Event}`)!;
		for (const [key, value] of pairs(events)) {
			new BazirRemote(`${key}`, Remote).OnServerEvent.Connect(value);
		}
		return this;
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
	private RemoteContainer: BazirRemoteContainer;
	private Networks = {
		[NetworkSettings.Function]: new Map<string, BazirRemote>(),
		[NetworkSettings.Event]: new Map<string, BazirRemote>(),
	};
	private Comunications = {
		[NetworkSettings.Function]: new Map<string, ClientEventsFunction>(),
		[NetworkSettings.Event]: new Map<string, Array<ClientEventsFunction>>(),
	};
	public static Is(object: unknown): object is typeof ClientNetwork.prototype {
		return typeIs(object, "table") && getmetatable(object) === ClientNetwork;
	}
	Invoke<T>(key: string, ...args: unknown[]): Promise<T> | undefined {
		return this.Networks[NetworkSettings.Function].get(key)?.InvokeServer<T>(...args);
	}
	Fire(key: string, ...args: unknown[]) {
		return this.Networks[NetworkSettings.Event].get(key)?.FireServer(...args);
	}
	BindFunctions(functions: { [k: string]: ClientEventsFunction }) {
		for (const [key, value] of pairs(functions)) {
			this.Comunications[NetworkSettings.Function].set(`${key}`, value);
		}
		return this;
	}
	BindEvents(events: { [k: string]: ClientEventsFunction }) {
		for (const [key, value] of pairs(events)) {
			(
				this.Comunications[NetworkSettings.Event].get(`${key}`) ??
				this.Comunications[NetworkSettings.Event].set(`${key}`, []).get(`${key}`)
			)?.push(value);
		}
		return this;
	}
	constructor(parent?: RemoteParent) {
		assert(!isServer, "Cannot create client network on server");
		this.RemoteContainer = new BazirRemoteContainer(NetworkSettings.Name, [], parent);
		this.RemoteContainer.get(`${NetworkSettings.Event}`)?.OnClientEvent.Connect((key, ...args) => {
			assert(typeIs(key, "string"), "Key must be string");
			const funcs = this.Comunications[NetworkSettings.Event].get(key);
			if (funcs) {
				funcs.forEach(async (func) => func(...args));
			}
		});
		this.RemoteContainer.get(`${NetworkSettings.Function}`)!.OnClientInvoke = (key, ...args) => {
			assert(typeIs(key, "string"), "Key must be string");
			const func = this.Comunications[NetworkSettings.Function].get(key);
			assert(func !== undefined, "Cannot find function");
			return func(...args);
		};
		this.RemoteContainer.get(`${NetworkSettings.Function}`)
			?.GetChildren()
			.forEach((child) => {
				this.Networks[NetworkSettings.Function].set(child.Path, child);
			});
		this.RemoteContainer.get(`${NetworkSettings.Event}`)
			?.GetChildren()
			.forEach((child) => {
				this.Networks[NetworkSettings.Event].set(child.Path, child);
			});
	}
}

function CleanupQueue() {
	for (const [_, Thread] of pairs(YieldQueue)) {
		if (coroutine.status(Thread) === "suspended") {
			coroutine.resume(Thread, [false, "Cleanup"]);
		}
	}
}

function CleanupRemotes() {
	BazirRemotes.forEach((current) => {
		current.Children.forEach((child) => {
			child?.Destroy();
		});
		current.Children.clear();
	});
	BazirRemotes.clear();
}

function Cleanup() {
	CleanupQueue();
	CleanupRemotes();
}

if (isServer) {
	game.BindToClose(() => {
		if (!Settings.AutoCleanup) {
			return;
		}
		Cleanup();
	});
} else {
	Players.LocalPlayer.AncestryChanged.Connect(() => {
		if (!Settings.AutoCleanup) {
			return;
		}
		Cleanup();
	});
}

export default { setSetting, setSettings };
