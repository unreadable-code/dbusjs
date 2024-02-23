"use strict";

const path = require("path");
const {newConfigBuilder} = require("webpack-config-builder");
const pathBuild = path.resolve(__dirname, "dist");

module.exports = newConfigBuilder()
    .asLibrary("umd", "dbusjs")
    .compile("web", "/src/index.ts", pathBuild, "index.js");