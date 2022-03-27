class Signal<ConnectedFunctionSignature extends (...args: any) => any = (...args: any) => any> {
	public static Is(object: unknown): object is Signal {
		return typeIs(object, "table") && getmetatable(object) === Signal;
	}
	private Bindable = new Instance("BindableEvent");
	Connect(callback: ConnectedFunctionSignature): RBXScriptConnection {
		return this.Bindable.Event.Connect(callback);
	}
	Fire(...args: Parameters<ConnectedFunctionSignature>) {
		return this.Bindable.Fire(...(args as unknown[]));
	}
	Wait(): LuaTuple<Parameters<ConnectedFunctionSignature>> {
		return this.Bindable.Event.Wait() as LuaTuple<Parameters<ConnectedFunctionSignature>>;
	}
	Destroy() {
		this.Bindable.Destroy();
	}
}

export = Signal;
