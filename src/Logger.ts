const Settings = {
	LogEnabled: false,
	LogAdvancedEnabled: false,
};
const Log = {
	Info: async (message: string, ...optionalParams: any[]) => {
		if (Settings.LogEnabled) {
			print(message, optionalParams);
		}
	},
	Error: async (message: string, ...optionalParams: any[]) => {
		if (Settings.LogEnabled) {
			print(message, optionalParams);
		}
	},
	Debug: async (message: string, ...optionalParams: any[]) => {
		if (Settings.LogAdvancedEnabled) {
			print(message, optionalParams);
		}
	},
	Warn: async (message: string, ...optionalParams: any[]) => {
		warn(message, optionalParams);
	},
};

export { Log };
