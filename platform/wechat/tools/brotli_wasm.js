const fs = require("fs");
const zlib = require("zlib");

const input = fs.readFileSync(process.argv[2]);
const output = zlib.brotliCompressSync(input, {
	params: {
		[zlib.constants.BROTLI_PARAM_QUALITY]: 5,
	},
});
fs.writeFileSync(process.argv[3], output);
process.stdout.write(String(output.length) + "\n");
