import { Janitor } from "@rbxts/janitor";
import Signal from "./Signal";
import Compression from "./Compression";
/* import type SignalType from "./Signal";
import type CompressionType from "./Compression";
import type PromiseType from "./GetPromiseLibrary";

const Promise = require(script.FindFirstChild("GetPromiseLibrary") as ModuleScript) as typeof PromiseType;
const Signal = require(script.FindFirstChild("Signal") as ModuleScript) as typeof SignalType;
const Compression = require(script.FindFirstChild("Compression") as ModuleScript) as typeof CompressionType; */

function async<T extends Callback>(f: T): T {
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore
	return Promise.promisify(f);
}

const LogSettings = {
	LogEnabled: false,
	LogAdvancedEnabled: false,
};

const Log = {
	Info: async((message: string, ...optionalParams: unknown[]) => {
		if (LogSettings.LogEnabled) {
			print(message, optionalParams);
		}
	}),
	Error: async((message: string, ...optionalParams: unknown[]) => {
		if (LogSettings.LogEnabled) {
			print(message, optionalParams);
		}
	}),
	Debug: async((message: string, ...optionalParams: unknown[]) => {
		if (LogSettings.LogAdvancedEnabled) {
			print(message, optionalParams);
		}
	}),
	Warn: async((message: string, ...optionalParams: unknown[]) => {
		warn(message, optionalParams);
	}),
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

const enum Events {
	FireServer = "Event<FireServer>",
	FireClient = "Event<FireClient>",
	FireAllClients = "Event<FireAllClients>",
}

const enum Requests {
	FireServer = "Request<FireServer>",
	InvokeServer = "Request<InvokeServer>",
	FireClient = "Request<FireClient>",
	InvokeClient = "Request<InvokeClient>",
	GetChildren = "Request<GetChildren>",
	ChildAdded = "Request<ChildAdded>",
	ChildRemoved = "Request<ChildRemoved>",
	GetTags = "Request<GetTags>",
	GetProperties = "Request<GetProperties>",
	UpdateTag = "Request<UpdateTag>",
}

type Remotes = BazirRemote | BazirRemoteContainer<[]>;
type RemoteParent = Remotes | Instance;
type RemoteNameType = "BazirRemote" | "BazirRemoteContainer";

//TODO
/* type RequestTypes =
	| [Events.FireServer, Requests, string, ...unknown[]]
	| [Events.FireClient, Player, Requests, string, ...unknown[]]
	| [Events.FireAllClients, Requests, string, ...unknown[]]; */

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
	throw "Unknown remote type";
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
			IsRemote(value) || typeIs(value, "Instance"),
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
		(Request: typeof Requests[keyof typeof Requests], uuid: string, ...args: unknown[]) => void
	>;
	public Parent!: RemoteParent;
	public InvokeClient<T>(player: Player, ...args: unknown[]) {
		assert(isServer, "can only be called from the server");
		assert(typeIs(player, "Instance") && player.IsA("Player"), "player must be a Player");
		const uuid = HttpService.GenerateGUID(false);
		const returnPromise = new Promise<T>((resolve, reject) => {
			YieldQueue[uuid] = coroutine.running();
			this._request_client(uuid, Events.FireClient, Requests.InvokeClient, player, ...args);
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
			this._request_server(uuid, Events.FireServer, Requests.InvokeServer, ...args);
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
		return this.GetChildren().map((child) => {
			return {
				RemoteType: GetRemoteType(child),
				Path: child.Path,
			};
		});
	}
	/** @hidden */
	private _GetProperties() {
		return {
			Tags: this.Tags,
			Childrens: this._GetChildren(),
		};
	}
	public GetChildren() {
		return BazirRemotes.get(this)?.Children ?? [];
	}
	public FireAllClients(...args: unknown[]) {
		assert(isServer, "can only be called from the server");
		return this._request_client(
			HttpService.GenerateGUID(false),
			Events.FireAllClients,
			Requests.FireClient,
			undefined,
			...args,
		);
	}
	public FireClient(player: Player, ...args: unknown[]) {
		assert(isServer, "can only be called from the server");
		assert(typeIs(player, "Instance") && player.IsA("Player"), "expected Player got %s".format(typeOf(player)));
		return this._request_client(undefined, Events.FireClient, Requests.FireClient, player, ...args);
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
		assert(typeIs(position, "Vector3"), "expected Vector3 got %s".format(typeOf(position)));
		assert(typeIs(distance, "number"), "expected number got %s".format(typeOf(distance)));
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
		assert(typeOf(ignoreclient) === "table", "expected table got %s".format(typeOf(ignoreclient)));
		assert(typeIs(position, "Vector3"), "expected Vector3 got %s".format(typeOf(position)));
		assert(typeIs(distance, "number"), "expected number got %s".format(typeOf(distance)));
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
		return this._request_server(undefined, Events.FireServer, Requests.FireServer, ...args);
	}
	public SetTag(key: string, value: unknown) {
		assert(typeIs(key, "string"), "expected string got %s".format(typeOf(key)));
		this.Tags.set(key, value);
		if (isServer) {
			this._request_client(
				HttpService.GenerateGUID(false),
				Events.FireAllClients,
				Requests.UpdateTag,
				undefined,
				[key, value],
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
	public _getRemoteParent(Parent = this.Parent): Instance {
		return typeIs(Parent, "Instance") ? Parent : Parent?._GetorCreateRemote();
	}
	/** @hidden */
	public _createRemote(parent = this._getRemoteParent()): typeof BazirRemote.prototype.RemoteEvent {
		if (this.RemoteEvent) {
			return this.RemoteEvent;
		}
		let RemoteEvent = parent.FindFirstChild(this.Path) as typeof BazirRemote.prototype.RemoteEvent;
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
		parent = this._getRemoteParent(),
	): typeof BazirRemote.prototype.RemoteEvent | undefined {
		if (this.RemoteEvent) {
			return this.RemoteEvent;
		}
		let RemoteEvent = parent?.FindFirstChild(this.Path) as RemoteEvent | undefined;
		if (!RemoteEvent) {
			RemoteEvent = (
				timeout <= 0 ? RemoteEvent : parent?.WaitForChild(this.Path, timeout)
			) as typeof BazirRemote.prototype.RemoteEvent;
		}
		this.RemoteEvent = RemoteEvent;
		return RemoteEvent;
	}
	/** @hidden */
	public _GetorCreateRemote(parent?: RemoteParent): typeof BazirRemote.prototype.RemoteEvent {
		return (
			this._getRemote(isServer ? 0 : undefined, this._getRemoteParent(parent)) ??
			this._createRemote(this._getRemoteParent(parent))
		);
	}
	/** @hidden */
	public _updateremoteparent(parent: Instance) {
		assert(typeIs(parent, "Instance"), "expected Instance got %s".format(typeOf(parent)));
		const RemoteEvent = this._GetorCreateRemote();
		if (isServer) {
			RemoteEvent.Parent = parent;
		}
	}
	/** @hidden */
	public _checkparent(parent: unknown): asserts parent is RemoteParent {
		BazirRemote.AssertParent(parent);
		const ParentData = BazirRemotes.get(parent);
		assert(ParentData?.Children.find((i) => i.Path === this.Path) === undefined, "this path is already created");
	}
	/** @hidden */
	public _setparent(parent: unknown): asserts parent is RemoteParent {
		this._checkparent(parent);
		const CurrentData =
			BazirRemotes.get(this) ??
			BazirRemotes.set(this, {
				Children: [],
			}).get(this)!;
		const ParentData =
			BazirRemotes.get(parent) ??
			BazirRemotes.set(parent, {
				Children: [],
			}).get(parent)!;
		ParentData.Children.push(this);
		CurrentData.LastParent = CurrentData.Parent;
		CurrentData.Parent = parent;
		rawset(this, "Parent", parent);
	}
	/** @hidden */
	public _changeparent(parent: unknown) {
		this._setparent(parent);
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
			this._request_client(
				HttpService.GenerateGUID(false),
				Events.FireAllClients,
				Requests.ChildRemoved,
				undefined,
				{
					RemoteType: GetRemoteType(child),
					Path: child.Path,
				},
			);
		}
	}
	/** @hidden */
	public _addChildRemote(child: Remotes): void {
		const CurrentData = BazirRemotes.get(this);
		const LastParent = CurrentData?.LastParent;
		if (IsRemote(LastParent)) {
			LastParent._removeChildRemote(child);
		}
		child._updateremoteparent(this.RemoteEvent);
		if (isServer) {
			this._request_client(
				HttpService.GenerateGUID(false),
				Events.FireAllClients,
				Requests.ChildAdded,
				undefined,
				{
					RemoteType: GetRemoteType(child),
					Path: child.Path,
				},
			);
		}
		this.ChildAdded.Fire(child);
	}

	private _request_server<E extends Events, R extends Requests>(
		uuid = HttpService.GenerateGUID(false),
		Event: E,
		Request: R,
		...args: unknown[]
	) {
		assert(!isServer, "this function is only available on the client");
		assert(typeIs(Event, "string"), "expected Events got %s".format(typeOf(Event)));
		assert(typeIs(Request, "string"), "expected Requests got %s".format(typeOf(Request)));
		switch (Event) {
			case Events.FireServer: {
				this.RemoteEvent.FireServer(Request, uuid, Compression.compress(HttpService.JSONEncode(args)));
				break;
			}
			default:
				throw "unknown event";
		}
	}

	private _request_client<E extends Events, R extends Requests>(
		uuid = HttpService.GenerateGUID(false),
		Event: E,
		Request: R,
		player: E extends Events.FireClient ? Player : void,
		...args: unknown[]
	) {
		assert(isServer, "this function is only available on the server");
		assert(typeIs(Event, "string"), "expected Events got %s".format(typeOf(Event)));
		assert(typeIs(Request, "string"), "expected Requests got %s".format(typeOf(Request)));
		switch (Event) {
			case Events.FireClient: {
				assert(
					typeIs(player, "Instance") && player.IsA("Player"),
					"expected Player got %s".format(typeOf(player)),
				);
				this.RemoteEvent.FireClient(player, Request, uuid, Compression.compress(HttpService.JSONEncode(args)));
				break;
			}
			case Events.FireAllClients: {
				Players.GetPlayers().forEach((player) => {
					this._request_client(uuid, Events.FireClient, Request, player, ...args);
				});
				break;
			}
			default:
				throw "unknown event";
		}
	}
	private _removeChild(RemoteType: RemoteNameType, Path: string) {
		assert(!isServer, "can only be called from the client");
		assert(typeIs(Path, "string"), "expected string got %s".format(typeOf(Path)));
		assert(typeIs(RemoteType, "string"), "expected string got %s".format(typeOf(RemoteType)));
		const CurrentData = BazirRemotes.get(this);
		if (!CurrentData) {
			return;
		}
		CurrentData.Children.remove(
			CurrentData.Children.findIndex((child) => GetRemoteType(child) === RemoteType && child.Path === Path),
		)?.Destroy();
	}
	private _createChild(RemoteType: RemoteNameType, Path: string) {
		assert(!isServer, "can only be called from the client");
		assert(typeIs(Path, "string"), "expected string got %s".format(typeOf(Path)));
		assert(typeIs(RemoteType, "string"), "expected string got %s".format(typeOf(RemoteType)));
		switch (RemoteType) {
			case "BazirRemote": {
				new BazirRemote(`${Path}`, this);
				break;
			}
			case "BazirRemoteContainer": {
				new BazirRemoteContainer(`${Path}`, [], this);
				break;
			}
			default:
				Log.Warn("unknown remote type %s".format(RemoteType));
				break;
		}
	}
	public Destroy() {
		const CurrentData = BazirRemotes.get(this);
		if (CurrentData) {
			const CurrenParent = CurrentData.Parent;
			if (CurrenParent) {
				const ParrentData = BazirRemotes.get(CurrenParent);
				if (IsRemote(CurrenParent)) {
					CurrenParent._removeChildRemote(this);
				}
				if (ParrentData) {
					ParrentData.Children.remove(ParrentData.Children.indexOf(this));
					if (typeIs(CurrenParent, "Instance") && ParrentData.Children.size() === 0) {
						BazirRemotes.delete(CurrenParent);
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
		table.clear(this);
		setmetatable<BazirRemote>(this, undefined as unknown as LuaMetatable<BazirRemote>);
	}
	constructor(public Path: string, Parent: RemoteParent = script) {
		assert(typeIs(Path, "string"), `expects string, got ${type(Path)}`);
		assert(Path.size() > 0, "path can't be empty");
		assert(Path.size() < 256, "path can't be longer than 255 characters");
		this._changeparent(Parent);
		const mt = getmetatable(this) as LuaMetatable<BazirRemote>;
		mt.__tostring = (remote) => `BazirRemote<${tostring(remote.Path)}>`;
		mt.__newindex = (remote, index, value) => {
			switch (index) {
				case "RemoteEvent": {
					assert(remote[index] === undefined, "Cannot change remote event");
					rawset(remote, index, value);
					return;
				}
				case "Parent": {
					this._changeparent(value);
					return;
				}
				case "OnServerInvoke": {
					assert(remote[index] === undefined, "Cannot change on server invoke");
					assert(typeOf(value) === "function", "On server invoke must be function");
					assert(isServer, "On server invoke can be set only on server");
					rawset(remote, index, value);
					return;
				}
				case "OnClientInvoke": {
					assert(remote[index] === undefined, "Cannot change on client invoke");
					assert(typeOf(value) === "function", "On client invoke must be function");
					assert(!isServer, "On client invoke can be set only on client");
					rawset(remote, index, value);
					return;
				}
				default:
					assert(
						rawget(remote, BRType.Loaded) !== true,
						`[BazirRemote] ${tostring(remote.Path)}[${index}] is read only`,
					);
					rawset(remote, index, value);
					return;
			}
		};
		assert(this.RemoteEvent !== undefined, "failed to create remote event");
		if (isServer) {
			this.Janitor.Add(
				this.RemoteEvent.OnServerEvent.Connect((player, Request, uuid, data) => {
					if (!typeIs(Request, "string") || !typeIs(uuid, "string")) {
						return;
					}
					const result = opcall(() => {
						return HttpService.JSONDecode(Compression.decompress(data)) as unknown[];
					});
					const args = result.success ? result.value : [];
					Log.Info(
						`[Server] - [${player.Name}] > ${numberToStorageSpace(
							`${Request}${uuid}${HttpService.JSONEncode(args)}`.size(),
						)} - ${Request} - ${uuid} => ${(args as (keyof CheckablePrimitives)[])
							.map((arg) => type(arg))
							.join(", ")}`,
						args,
					);
					switch (Request) {
						case Requests.InvokeServer: {
							this._request_client(
								uuid as string,
								Events.FireClient,
								Request,
								player,
								pcall(() => {
									assert(this.OnServerInvoke !== undefined, `${Path} isn't invoke on server`);
									return [this.OnServerInvoke(player, ...args)];
								}),
							);
							break;
						}
						case Requests.InvokeClient: {
							const Thread = YieldQueue[uuid as string];
							if (Thread && coroutine.status(Thread) === "suspended") {
								coroutine.resume(Thread, ...args);
							}
							break;
						}
						case Requests.FireServer: {
							this.OnServerEvent.Fire(player, ...args);
							break;
						}
						case Requests.GetChildren: {
							this._request_client(
								uuid as string,
								Events.FireClient,
								Request,
								player,
								pcall(() => {
									return [this._GetChildren()];
								}),
							);
							break;
						}
						case Requests.GetTags: {
							this._request_client(
								uuid as string,
								Events.FireClient,
								Request,
								player,
								pcall(() => {
									return [this.Tags];
								}),
							);
							break;
						}
						case Requests.GetProperties: {
							this._request_client(
								uuid as string,
								Events.FireClient,
								Request,
								player,
								pcall(() => {
									return [this._GetProperties()];
								}),
							);
							break;
						}
						default:
							Log.Info(`[Server] - [${player.Name}] > unknown request ${Request}`);
							player.Kick("Invalid Request");
							break;
					}
				}),
			);
		} else {
			this.Janitor.Add(
				this.RemoteEvent.OnClientEvent.Connect((Request, uuid, data) => {
					assert(typeIs(Request, "string"), "expected string got %s".format(typeOf(Request)));
					assert(typeIs(uuid, "string"), "expected string got %s".format(typeOf(uuid)));
					const result = opcall(() => {
						return HttpService.JSONDecode(Compression.decompress(data)) as unknown[] as unknown[];
					});
					const args = result.success ? result.value : [];
					Log.Info(
						`[Client] - [localplayer] > ${numberToStorageSpace(
							`${Request}${uuid}${HttpService.JSONEncode(args)}`.size(),
						)} - ${Request} - ${uuid} => ${(args as (keyof CheckablePrimitives)[])
							.map((arg) => type(arg))
							.join(", ")}`,
						args,
					);
					switch (Request) {
						case Requests.InvokeServer: {
							const Thread = YieldQueue[uuid];
							if (Thread && coroutine.status(Thread) === "suspended") {
								coroutine.resume(Thread, ...args);
							}
							break;
						}
						case Requests.InvokeClient: {
							this._request_server(
								uuid,
								Events.FireServer,
								Request,
								pcall(() => {
									assert(this.OnClientInvoke !== undefined, `${Path} isn't invoke on client`);
									return [this.OnClientInvoke(...args)];
								}),
							);
							break;
						}
						case Requests.FireClient: {
							this.OnClientEvent.Fire(...args);
							break;
						}
						case Requests.GetChildren: {
							const Thread = YieldQueue[uuid];
							if (Thread && coroutine.status(Thread) === "suspended") {
								coroutine.resume(Thread, ...args);
							}
							break;
						}
						case Requests.ChildRemoved: {
							assert(typeOf(args) === "table", "ChildRemoved args isn't table");
							assert(args.size() === 1, "ChildRemoved args data length isn't 1");
							const Child = args[0];
							assert(typeIs(Child, "table"), `expect Child to be table but got ${typeOf(Child)}`);
							const { RemoteType, Path } = Child as {
								RemoteType: RemoteNameType;
								Path: string;
							};
							assert(
								typeIs(RemoteType, "string"),
								`expect RemoteType to be string but got ${typeOf(RemoteType)}`,
							);
							assert(typeIs(Path, "string"), `expect Path to be string but got ${typeOf(Path)}`);
							this._removeChild(RemoteType, Path);
							break;
						}
						case Requests.ChildAdded: {
							assert(typeOf(args) === "table", "ChildRemoved args isn't table");
							assert(args.size() === 1, "ChildAdded args data length isn't 1");
							const Child = args[0];
							assert(typeIs(Child, "table"), `expect Child to be table but got ${typeOf(Child)}`);
							const { RemoteType, Path } = Child as {
								RemoteType: RemoteNameType;
								Path: string;
							};
							assert(
								typeIs(RemoteType, "string"),
								`expect RemoteType to be string but got ${typeOf(RemoteType)}`,
							);
							assert(typeIs(Path, "string"), `expect Path to be string but got ${typeOf(Path)}`);
							this._createChild(RemoteType, Path);
							break;
						}
						case Requests.GetTags: {
							const Thread = YieldQueue[uuid];
							if (Thread && coroutine.status(Thread) === "suspended") {
								coroutine.resume(Thread, ...args);
							}
							break;
						}
						case Requests.GetProperties: {
							const Thread = YieldQueue[uuid];
							if (Thread && coroutine.status(Thread) === "suspended") {
								coroutine.resume(Thread, ...args);
							}
							break;
						}
						case Requests.UpdateTag: {
							this.Tags.set(...(args as [string, unknown]));
							break;
						}
						default:
							Log.Info(`[Client] - [localplayer] > Unknown request: ${Request}`);
							break;
					}
				}),
			);
			const Taguuid = HttpService.GenerateGUID(false);
			const [success, result] = new Promise<ReturnType<typeof BazirRemote.prototype._GetProperties>>(
				(resolve, reject) => {
					YieldQueue[Taguuid] = coroutine.running();
					this._request_server(Taguuid, Events.FireServer, Requests.GetProperties);
					const thread = coroutine.yield()[0] as LuaTuple<[false, string] | [true, unknown[]]>;
					if (!thread[0]) {
						return reject(thread[1]);
					}
					// eslint-disable-next-line @typescript-eslint/ban-ts-comment
					//@ts-ignore
					resolve(...thread[1]);
				},
			)
				.timeout(Settings.Servertimeout)
				.then(({ Tags, Childrens }) => {
					const YieldPromises = new Array<Promise<unknown>>();
					this.Tags = Tags;
					Childrens.forEach(({ RemoteType, Path }) => {
						YieldPromises.push(Promise.try(() => this._createChild(RemoteType, Path)));
					});
					Promise.all(YieldPromises).await();
				})
				.await();

			YieldQueue[Taguuid] = undefined;
			if (!success) {
				throw `failed to get properties on server, ${result} for ${this.Path}`;
			}
		}
		rawset(this, BRType.Loaded, true);
	}
}
export class BazirRemoteContainer<T extends string[] = string[]> extends BazirRemote {
	public static Is(object: unknown): object is typeof BazirRemoteContainer.prototype {
		return typeIs(object, "table") && getmetatable(object) === BazirRemoteContainer;
	}
	private Remotes: Map<string, BazirRemote> = new Map();
	get(key: string) {
		assert(typeOf(key) === "string", "key must be string");
		return this.Remotes.get(key);
	}
	waitfor(key: string, timeout: number = isServer ? Settings.Servertimeout : Settings.Clienttimeout) {
		assert(typeOf(key) === "string", "key must be string");
		assert(typeOf(timeout) === "number", "timeout must be number");
		let DeltaTime = 0;
		let Warned = false;
		let Remote;
		while (!Remote) {
			Remote = this.get(key);
			if (Remote) {
				return Remote;
			}
			if (DeltaTime >= 5 && !Warned) {
				Warned = true;
				warn(debug.traceback(`Infinite Yield Possible on waitfor ${key} on ${this.Path}`));
			}
			if (DeltaTime >= timeout) {
				throw `failed to wait for ${key} on ${this.Path}`;
			}
			DeltaTime += task.wait();
		}
	}
	add(key: string) {
		assert(isServer, "Cannot add remote on client");
		assert(typeOf(key) === "string", "key must be string");
		return new BazirRemote(`${key}`, this);
	}
	constructor(public Path: string, starters: T, parent: RemoteParent = script) {
		assert(typeOf(Path) === "string", "Path must be string");
		assert(typeOf(starters) === "table", "Starters must be table");
		super(Path, parent);
		if (isServer) {
			starters.forEach((starter) => {
				this.add(starter);
			});
		}
		this.ChildAdded.Connect((child) => {
			this.Remotes.set(child.Path, child);
		});
		this.ChildRemoved.Connect((child) => {
			this.Remotes.delete(child.Path);
		});
		super.GetChildren().forEach((child) => {
			this.Remotes.set(child.Path, child);
		});
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
		assert(typeOf(key) === "string", "key must be string");
		return this.RemoteContainer.get(`${NetworkSettings.Function}`)!.InvokeClient<T>(player, `${key}`, ...args);
	}
	Fire(key: string, player: Player | Player[], ...args: unknown[]) {
		assert(typeOf(key) === "string", "key must be string");
		if (typeIs(player, "table")) {
			return this.RemoteContainer.get(`${NetworkSettings.Event}`)!.FireClients(
				player as Player[],
				`${key}`,
				...args,
			);
		}
		assert(typeOf(player) === "Instance", "player must be Instance");
		return this.RemoteContainer.get(`${NetworkSettings.Event}`)!.FireClient(player, `${key}`, ...args);
	}
	FireAll(key: string, ...args: unknown[]) {
		assert(typeOf(key) === "string", "key must be string");
		return this.RemoteContainer.get(`${NetworkSettings.Event}`)!.FireAllClients(`${key}`, ...args);
	}
	FireOther(key: string, ignoreclient: Player[], ...args: unknown[]) {
		assert(typeOf(key) === "string", "key must be string");
		return this.RemoteContainer.get(`${NetworkSettings.Event}`)!.FireOtherClients(ignoreclient, `${key}`, ...args);
	}
	FireAllWithinDistance(key: string, position: Vector3, distance: number, ...args: unknown[]) {
		assert(typeOf(key) === "string", "key must be string");
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
		assert(typeOf(key) === "string", "key must be string");
		return this.RemoteContainer.get(`${NetworkSettings.Event}`)!.FireOtherClientsWithinDistance(
			ignoreclient,
			position,
			distance,
			`${key}`,
			...args,
		);
	}
	BindFunctions(functions: { [k: string]: ServerEventsFunction }) {
		assert(typeOf(functions) === "table", "functions must be table");
		const Remote = this.RemoteContainer.get(`${NetworkSettings.Function}`)!;
		for (const [key, value] of pairs(functions)) {
			new BazirRemote(`${key}`, Remote).OnServerInvoke = value;
		}
		return this;
	}
	BindEvents(events: { [k: string]: ServerEventsFunction }) {
		assert(typeOf(events) === "table", "events must be table");
		const Remote = this.RemoteContainer.get(`${NetworkSettings.Event}`)!;
		for (const [key, value] of pairs(events)) {
			new BazirRemote(`${key}`, Remote).OnServerEvent.Connect(value);
		}
		return this;
	}
	constructor(parent: RemoteParent = script, name = NetworkSettings.Name) {
		assert(isServer, "Cannot create server network on client");
		this.RemoteContainer = new BazirRemoteContainer(
			name,
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
		assert(typeOf(key) === "string", "key must be string");
		return this.Networks[NetworkSettings.Function].get(key)?.InvokeServer<T>(...args);
	}
	Fire(key: string, ...args: unknown[]) {
		assert(typeOf(key) === "string", "key must be string");
		return this.Networks[NetworkSettings.Event].get(key)?.FireServer(...args);
	}
	BindFunctions(functions: { [k: string]: ClientEventsFunction }) {
		assert(typeOf(functions) === "table", "functions must be table");
		for (const [key, value] of pairs(functions)) {
			this.Comunications[NetworkSettings.Function].set(`${key}`, value);
		}
		return this;
	}
	BindEvents(events: { [k: string]: ClientEventsFunction }) {
		assert(typeOf(events) === "table", "events must be table");
		for (const [key, value] of pairs(events)) {
			(
				this.Comunications[NetworkSettings.Event].get(`${key}`) ??
				this.Comunications[NetworkSettings.Event].set(`${key}`, []).get(`${key}`)
			)?.push(value);
		}
		return this;
	}
	constructor(parent: RemoteParent = script, name = NetworkSettings.Name) {
		assert(!isServer, "Cannot create client network on server");
		this.RemoteContainer = new BazirRemoteContainer(name, [], parent);

		const EventRemote = this.RemoteContainer.waitfor(`${NetworkSettings.Event}`, Settings.Clienttimeout);
		assert(EventRemote, "remote event not found");
		const FunctionRemote = this.RemoteContainer.waitfor(`${NetworkSettings.Function}`, Settings.Clienttimeout);
		assert(FunctionRemote, "remote function not found");

		EventRemote.ChildAdded.Connect((child) => {
			this.Networks[NetworkSettings.Event].set(child.Path, child);
		});
		EventRemote.ChildRemoved.Connect((child) => {
			this.Networks[NetworkSettings.Event].delete(child.Path);
		});
		EventRemote?.GetChildren().forEach((child) => {
			this.Networks[NetworkSettings.Event].set(child.Path, child);
		});
		EventRemote?.OnClientEvent.Connect((key, ...args) => {
			assert(typeIs(key, "string"), "Key must be string");
			const funcs = this.Comunications[NetworkSettings.Event].get(key);
			if (funcs) {
				funcs.forEach(
					async((func) => {
						func(...args);
					}),
				);
			}
		});

		FunctionRemote.ChildAdded.Connect((child) => {
			this.Networks[NetworkSettings.Function].set(child.Path, child);
		});
		FunctionRemote.ChildRemoved.Connect((child) => {
			this.Networks[NetworkSettings.Function].delete(child.Path);
		});
		FunctionRemote?.GetChildren().forEach((child) => {
			this.Networks[NetworkSettings.Function].set(child.Path, child);
		});
		FunctionRemote!.OnClientInvoke = (key, ...args) => {
			assert(typeIs(key, "string"), "Key must be string");
			const func = this.Comunications[NetworkSettings.Function].get(key);
			assert(func !== undefined, "Cannot find function");
			return func(...args);
		};
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
		/* current.Children.clear(); */
	});
	/* BazirRemotes.clear(); */
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
