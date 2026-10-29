const fs = require("node:fs"),
  fsp = require("node:fs/promises"),
  path = require("node:path");
const root = process.env.AFL_TEST_ROOT,
  read = fsp.readFile;
fsp.readFile = async function (file, ...args) {
  if (String(file).endsWith("/external/core/lib.afl")) {
    if (fs.existsSync(path.join(root, "fail"))) {
      const error: NodeJS.ErrnoException = new Error(
        "Simulated unreadable dependency",
      );
      error.code = "EACCES";
      error.path = String(file);
      throw error;
    }
    if (fs.existsSync(path.join(root, "pause"))) {
      const result = await read.call(this, file, ...args);
      fs.writeFileSync(path.join(root, "loading"), "");
      while (fs.existsSync(path.join(root, "pause"))) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return result;
    }
  }
  return read.call(this, file, ...args);
};
require("node:module").syncBuiltinESMExports();
