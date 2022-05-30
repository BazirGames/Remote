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
	Traffic: 1,
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

/*
TODO
- Add @client and @server label
- Remove Import
- Queue system
- Middleware
- Log system
- RemoteAccess = ["Event", "Function"]
 RequireAccess("Event" | "Function")
- Add test
- License
- Document
- Publish
*/

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

export function setSetting<T extends keyof typeof Settings>(setting: T, value: typeof Settings[T]) {
	assert(Settings[setting] !== undefined, `${setting} isn't a setting`);
	assert(
		typeIs(value, typeOf(Settings[setting])),
		"expected %s got %s".format(typeOf(Settings[setting]), typeOf(value)),
	);
	Settings[setting] = value;
}

export function setSettings(settings: {
	[K in keyof typeof Settings]?: typeof Settings[K];
}) {
	assert(typeIs(settings, "table"), "expected table got %s".format(typeOf(settings)));
	for (const [setting, value] of pairs(settings)) {
		setSetting(setting, value);
	}
}

function GetRemoteFromPath(path: string, parent: RemoteParent) {
	const ParrentData = BazirRemotes.get(parent);
	if (ParrentData === undefined) {
		return;
	}
	return ParrentData.Children.find((child) => child.Path === path);
}

function GetRemoteType(remote: Remotes): RemoteNameType {
	if (BazirRemote.Is(remote)) {
		return "BazirRemote";
	} else if (BazirRemoteContainer.Is(remote)) {
		return "BazirRemoteContainer";
	}
	throw "Unknown remote type";
}

export function IsRemote(remote: unknown): remote is BazirRemote | BazirRemoteContainer<[]> {
	return BazirRemote.Is(remote) || BazirRemoteContainer.Is(remote);
}

function FindFirstChildByNameWhichIsA<T extends keyof Instances>(
	instance: Instance,
	child: string,
	className: T,
): Instances[T] | undefined {
	assert(typeIs(instance, "Instance"), "expected Instance got %s".format(typeOf(instance)));
	assert(typeIs(child, "string"), "expected string got %s".format(typeOf(child)));
	assert(typeIs(className, "string"), "expected string got %s".format(typeOf(className)));

	// first scan by name
	const cachedFindByName = instance.FindFirstChild(child);
	if (cachedFindByName && cachedFindByName.IsA(className)) {
		return cachedFindByName;
	}

	// second scan by IsA
	const cachedFindByClass = instance.FindFirstChildWhichIsA(className);
	if (cachedFindByClass && cachedFindByClass.Name === child) {
		return cachedFindByClass;
	}

	// slow loop find
	for (const instanceChild of instance.GetChildren()) {
		if (instanceChild.Name === child && instanceChild.IsA(className)) {
			return instanceChild;
		}
	}
}

function WaitForChildByNameWhichIsA<T extends keyof Instances>(
	instance: Instance,
	child: string,
	className: T,
	timeout: number = math.huge,
) {
	assert(typeIs(instance, "Instance"), "expected Instance got %s".format(typeOf(instance)));
	assert(typeIs(child, "string"), "expected string got %s".format(typeOf(child)));
	assert(typeIs(className, "string"), "expected string got %s".format(typeOf(className)));
	assert(typeIs(timeout, "number"), "expected number got %s".format(typeOf(timeout)));

	let DeltaTime = 0;
	let Warned = false;
	let Child;
	while (!Child) {
		Child = FindFirstChildByNameWhichIsA(instance, child, className);
		if (Child) {
			return Child;
		}
		if (DeltaTime >= 5 && !Warned) {
			Warned = true;
			warn(debug.traceback(`Infinite yield possible waiting on ${instance.GetFullName()}`));
		}
		if (DeltaTime >= timeout) {
			break;
		}
		DeltaTime += RunService.Heartbeat.Wait()[0];
	}
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
	public InvokeClients<T>(players: Player[], ...args: unknown[]) {
		assert(typeOf(players) === "table", "expected table got %s".format(typeOf(players)));
		return Promise.all(players.map((player) => this.InvokeClient<T>(player, ...args)))
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
		assert(typeOf(players) === "table", "expected table got %s".format(typeOf(players)));
		players.forEach((player) => {
			this.FireClient(player, ...args);
		});
	}
	public FireFilterClients(predicate: (value: Player, index: number, array: Player[]) => boolean, ...args: unknown[]) {
		assert(isServer, "can only be called from the server");
		return this.FireClients(Players.GetPlayers().filter(predicate), ...args)
	}
	public FireOtherClients(ignoreclient: Player[], ...args: unknown[]) {
		assert(isServer, "can only be called from the server");
		return this.FireFilterClients(
			(player) => !ignoreclient.includes(player),
			...args,
		);
	}
	public FireAllClientsWithinDistance(position: Vector3, distance: number, ...args: unknown[]) {
		assert(isServer, "can only be called from the server");
		assert(typeIs(position, "Vector3"), "expected Vector3 got %s".format(typeOf(position)));
		assert(typeIs(distance, "number"), "expected number got %s".format(typeOf(distance)));
		return this.FireFilterClients(
			(player) => {
				return (
					player.Character &&
					player.Character.PrimaryPart &&
					player.Character.PrimaryPart.Position.sub(position).Magnitude <= distance
				);
			},
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
		return this.FireFilterClients(
			(player) => {
				return (
					player.Character &&
					player.Character.PrimaryPart &&
					player.Character.PrimaryPart.Position.sub(position).Magnitude <= distance &&
					!ignoreclient.includes(player)
				);
			},
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
		let RemoteEvent = FindFirstChildByNameWhichIsA(
			parent,
			this.Path,
			"RemoteEvent",
		) as typeof BazirRemote.prototype.RemoteEvent;
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
		let RemoteEvent = FindFirstChildByNameWhichIsA(
			parent,
			this.Path,
			"RemoteEvent",
		) as typeof BazirRemote.prototype.RemoteEvent;
		if (RemoteEvent === undefined) {
			RemoteEvent = WaitForChildByNameWhichIsA(
				parent,
				this.Path,
				"RemoteEvent",
				timeout,
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
		const Existing = GetRemoteFromPath(Path, Parent);
		if (Existing) {
			return Existing;
		}
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
	private Remotes = new Map<string, BazirRemote>();
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
			DeltaTime += RunService.Heartbeat.Wait()[0];
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