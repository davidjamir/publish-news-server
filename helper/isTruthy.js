function isTruthy(x) {
  const s = String(x == null ? "" : x)
    .trim()
    .toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y";
}

module.exports = { isTruthy };
