"use strict";

// extract_image_colors / theme-from-image tool. The actual logic lives in
// the shared assistant-tools submodule (see tools-agent/shared/README.md)
// — this file just injects Lain's own filesystem-sandboxing helpers.
const imageColorsTool = require("../shared/tools/imageColors");
const { resolveInputPath, isAllowed } = require("./paths");

function resolveImagePath(inputPath) {
  return imageColorsTool.resolveImagePath(inputPath, { resolveInputPath, isAllowed });
}

function extractImageColors(inputPath, opts = {}) {
  return imageColorsTool.extractImageColors(inputPath, { ...opts, resolveInputPath, isAllowed });
}

function themeFromImage(inputPath, opts = {}) {
  return imageColorsTool.themeFromImage(inputPath, { ...opts, resolveInputPath, isAllowed });
}

module.exports = {
  generateThemeColors: imageColorsTool.generateThemeColors,
  toColorsToml: imageColorsTool.toColorsToml,
  resolveImagePath,
  extractImageColors,
  themeFromImage,
};
