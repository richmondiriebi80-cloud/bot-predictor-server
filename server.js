function normalizeScore(score) {
  if (!score) {
    return "Non disponible";
  }

  const home = score.home;
  const away = score.away;

  function isRealScore(value) {
    if (value === null || value === undefined) {
      return false;
    }

    const text = String(value).trim();

    // Refuse les seuils comme -3.5, +1.5, 2.5, etc.
    if (text.indexOf(".") !== -1) {
      return false;
    }

    const number = Number(text);

    return (
      Number.isInteger(number) &&
      number >= 0 &&
      number <= 20
    );
  }

  if (!isRealScore(home) || !isRealScore(away)) {
    return "Non disponible";
  }

  return String(Number(home)) + "-" + String(Number(away));
}
