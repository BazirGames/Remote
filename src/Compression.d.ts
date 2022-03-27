declare const Compression: {
	compress: (data: string) => unknown;
	decompress: <T>(data: unknown) => T;
};

export = Compression;
