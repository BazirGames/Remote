class Signal<ConnectedFunctionSignature extends (...args: any) => any = (...args: any) => any> {
	public static Is(object: unknown): object is Signal {
		return typeIs(object, "table") && getmetatable(object) === Signal;
	}

	private Bindable = new Instance("BindableEvent");
	public Connect(callback: ConnectedFunctionSignature): RBXScriptConnection {
		return this.Bindable.Event.Connect((c: () => LuaTuple<Parameters<ConnectedFunctionSignature>>) =>
			callback(c()),
		);
	}
	/** @hidden */
	public Fire(...args: Parameters<ConnectedFunctionSignature>) {
		return this.Bindable.Fire(() => args as LuaTuple<[Parameters<ConnectedFunctionSignature>]>);
	}
	public Wait(): LuaTuple<Parameters<ConnectedFunctionSignature>> {
		return (this.Bindable.Event.Wait() as unknown as () => unknown)() as LuaTuple<
			Parameters<ConnectedFunctionSignature>
		>;
	}
	public Destroy() {
		this.Bindable.Destroy();
	}
}

export = Signal;
