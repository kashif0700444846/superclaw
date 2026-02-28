// This file tells pnpm which packages are allowed to run build scripts.
// better-sqlite3 requires native compilation on Linux.
'use strict';

module.exports = {
  hooks: {
    readPackage(pkg) {
      return pkg;
    }
  }
};
