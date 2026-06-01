// ============================================================
// 🌦️ MLB Weather — Open-Meteo HR carry multiplier (no API key)
// ============================================================
// Source: https://open-meteo.com (free, no key, no auth).
// Produces a weather multiplier for a batter's HR λ at a given park + first
// pitch, combining:
//   • Temperature — warm air is less dense, the ball carries farther
//     (~3–4% HR per +10°F). Baseline 70°F.
//   • Wind — wind blowing OUT toward center boosts HR; blowing IN suppresses.
//     Uses each park's home-plate→center-field bearing and the wind component
//     along that axis.
// Domes (fixed roof) return 1.0 (no weather). Retractable roofs are weighted
// down (we can't know roof state pre-game) via WEATHER_ROOF_WEIGHT.
//
// Best-effort: ANY fetch/parse failure returns 1.0 — never blocks a pipeline.
// VISUAL FORMATTING lives elsewhere; this file is model math + fetch only.
// ============================================================

// Park location + orientation. cf = compass bearing (deg, 0=N, 90=E) from home
// plate toward center field. roof: 'open' | 'dome' (fixed) | 'retract'.
// Coordinates/orientations are approximate (good enough for a directional
// wind model with a modest beta). Keyed by canonical abbr (see Config.js).
var MLB_WEATHER_PARKS = {
  ARI: { lat: 33.4455, lon: -112.0667, cf: 1, roof: 'retract' },
  ATL: { lat: 33.8907, lon: -84.4677, cf: 51, roof: 'open' },
  BAL: { lat: 39.2839, lon: -76.6217, cf: 30, roof: 'open' },
  BOS: { lat: 42.3467, lon: -71.0972, cf: 45, roof: 'open' },
  CHC: { lat: 41.9484, lon: -87.6553, cf: 30, roof: 'open' },
  CWS: { lat: 41.8300, lon: -87.6338, cf: 130, roof: 'open' },
  CIN: { lat: 39.0975, lon: -84.5067, cf: 102, roof: 'open' },
  CLE: { lat: 41.4962, lon: -81.6852, cf: 0, roof: 'open' },
  COL: { lat: 39.7559, lon: -104.9942, cf: 0, roof: 'open' },
  DET: { lat: 42.3390, lon: -83.0485, cf: 150, roof: 'open' },
  HOU: { lat: 29.7572, lon: -95.3555, cf: 345, roof: 'retract' },
  KC: { lat: 39.0517, lon: -94.4803, cf: 45, roof: 'open' },
  LAA: { lat: 33.8003, lon: -117.8827, cf: 45, roof: 'open' },
  LAD: { lat: 34.0739, lon: -118.2400, cf: 25, roof: 'open' },
  MIA: { lat: 25.7781, lon: -80.2196, cf: 30, roof: 'retract' },
  MIL: { lat: 43.0280, lon: -87.9712, cf: 135, roof: 'retract' },
  MIN: { lat: 44.9817, lon: -93.2776, cf: 90, roof: 'open' },
  NYM: { lat: 40.7571, lon: -73.8458, cf: 30, roof: 'open' },
  NYY: { lat: 40.8296, lon: -73.9262, cf: 75, roof: 'open' },
  OAK: { lat: 37.7516, lon: -122.2005, cf: 60, roof: 'open' },
  PHI: { lat: 39.9061, lon: -75.1665, cf: 15, roof: 'open' },
  PIT: { lat: 40.4469, lon: -80.0057, cf: 120, roof: 'open' },
  SD: { lat: 32.7073, lon: -117.1566, cf: 0, roof: 'open' },
  SEA: { lat: 47.5914, lon: -122.3325, cf: 90, roof: 'retract' },
  SF: { lat: 37.7786, lon: -122.3893, cf: 90, roof: 'open' },
  STL: { lat: 38.6226, lon: -90.1928, cf: 60, roof: 'open' },
  TB: { lat: 27.7682, lon: -82.6534, cf: 0, roof: 'dome' },
  TEX: { lat: 32.7473, lon: -97.0847, cf: 135, roof: 'retract' },
  TOR: { lat: 43.6414, lon: -79.3894, cf: 0, roof: 'retract' },
  WSN: { lat: 38.8730, lon: -77.0074, cf: 30, roof: 'open' },
};

var __mlbWeatherCache = {};

function mlbWeatherResetCache_() {
  __mlbWeatherCache = {};
}

function mlbWeatherEnabled_(cfg) {
  const raw = String(cfg && cfg['HR_PROMO_WEATHER'] != null ? cfg['HR_PROMO_WEATHER'] : 'Y')
    .trim()
    .toUpperCase();
  return raw === 'Y' || raw === 'TRUE' || raw === '1';
}

function mlbWeatherCfgNum_(cfg, key, def) {
  const x = parseFloat(String(cfg && cfg[key] != null ? cfg[key] : def).trim(), 10);
  return isNaN(x) ? def : x;
}

function mlbWeatherParkForAbbr_(homeAbbr) {
  const canon = typeof mlbCanonicalTeamAbbr_ === 'function'
    ? mlbCanonicalTeamAbbr_(homeAbbr)
    : String(homeAbbr || '').trim().toUpperCase();
  return MLB_WEATHER_PARKS[canon] || null;
}

/**
 * Fetch hourly temp(°F)/wind(mph)/wind-dir(deg) from Open-Meteo for a park and
 * pick the hour nearest first pitch. Returns {tempF, windMph, windFromDeg} or
 * null. Cached per park+UTC-hour. Best-effort — never throws.
 * @param {Object} park {lat,lon}
 * @param {Date} firstPitchUtc
 */
function mlbWeatherFetchAtFirstPitch_(park, firstPitchUtc) {
  if (!park || !(firstPitchUtc instanceof Date) || isNaN(firstPitchUtc.getTime())) return null;
  const ymd = Utilities.formatDate(firstPitchUtc, 'GMT', 'yyyy-MM-dd');
  const hourStr = Utilities.formatDate(firstPitchUtc, 'GMT', "yyyy-MM-dd'T'HH:00");
  const key = park.lat + ',' + park.lon + '|' + hourStr;
  if (Object.prototype.hasOwnProperty.call(__mlbWeatherCache, key)) {
    return __mlbWeatherCache[key];
  }
  let out = null;
  try {
    const url =
      'https://api.open-meteo.com/v1/forecast?latitude=' +
      encodeURIComponent(park.lat) +
      '&longitude=' +
      encodeURIComponent(park.lon) +
      '&hourly=temperature_2m,wind_speed_10m,wind_direction_10m' +
      '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=GMT' +
      '&start_date=' + ymd + '&end_date=' + ymd;
    Utilities.sleep(40);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const payload = JSON.parse(res.getContentText());
      const h = payload && payload.hourly ? payload.hourly : null;
      if (h && h.time && h.time.length) {
        let idx = h.time.indexOf(hourStr);
        if (idx < 0) {
          // Nearest hour fallback: match by date+hour prefix.
          const prefix = Utilities.formatDate(firstPitchUtc, 'GMT', 'yyyy-MM-dd') + 'T';
          const targetHr = parseInt(Utilities.formatDate(firstPitchUtc, 'GMT', 'HH'), 10);
          let best = -1;
          let bestDiff = 1e9;
          for (let i = 0; i < h.time.length; i++) {
            if (String(h.time[i]).indexOf(prefix) !== 0) continue;
            const hr = parseInt(String(h.time[i]).slice(11, 13), 10);
            const diff = Math.abs(hr - targetHr);
            if (diff < bestDiff) { bestDiff = diff; best = i; }
          }
          idx = best;
        }
        if (idx >= 0) {
          const tempF = parseFloat(h.temperature_2m[idx]);
          const windMph = parseFloat(h.wind_speed_10m[idx]);
          const windFromDeg = parseFloat(h.wind_direction_10m[idx]);
          out = {
            tempF: isNaN(tempF) ? NaN : tempF,
            windMph: isNaN(windMph) ? NaN : windMph,
            windFromDeg: isNaN(windFromDeg) ? NaN : windFromDeg,
          };
        }
      }
    }
  } catch (e) {
    Logger.log('mlbWeatherFetchAtFirstPitch_: ' + (e && e.message ? e.message : e));
  }
  __mlbWeatherCache[key] = out;
  return out;
}

/**
 * Pure-math HR weather multiplier from observed conditions + park orientation.
 * Exposed separately so it can be unit-tested without a network call.
 * @returns {number} multiplier (clamped); 1.0 when inputs missing.
 */
function mlbWeatherHrMultFromConditions_(wx, park, cfg) {
  if (!wx || !park) return 1;
  const tempBeta = mlbWeatherCfgNum_(cfg, 'WEATHER_TEMP_BETA', 0.03); // per +10°F
  const windBeta = mlbWeatherCfgNum_(cfg, 'WEATHER_WIND_BETA', 0.06); // per 10mph, fully out
  const lo = mlbWeatherCfgNum_(cfg, 'WEATHER_MULT_MIN', 0.85);
  const hi = mlbWeatherCfgNum_(cfg, 'WEATHER_MULT_MAX', 1.18);
  const roofWeight = mlbWeatherCfgNum_(cfg, 'WEATHER_ROOF_WEIGHT', 0.5);

  let tempMult = 1;
  if (!isNaN(wx.tempF)) {
    tempMult = 1 + tempBeta * ((wx.tempF - 70) / 10);
  }

  let windMult = 1;
  if (!isNaN(wx.windMph) && !isNaN(wx.windFromDeg) && park.cf != null) {
    // Direction the wind blows TOWARD (deg) = FROM + 180.
    const windTowardDeg = (wx.windFromDeg + 180) % 360;
    const diffDeg = (((windTowardDeg - park.cf) % 360) + 360) % 360;
    const alignment = Math.cos((diffDeg * Math.PI) / 180); // +1 out to CF, -1 in from CF
    windMult = 1 + windBeta * alignment * (wx.windMph / 10);
  }

  let mult = tempMult * windMult;
  // Retractable roofs: we can't know if it's open — temper the swing toward 1.
  if (park.roof === 'retract') {
    const w = Math.max(0, Math.min(1, roofWeight));
    mult = 1 + (mult - 1) * w;
  }
  return Math.max(lo, Math.min(hi, Math.round(mult * 1000) / 1000));
}

/**
 * HR weather multiplier for a home park at first pitch. Domes → 1.0.
 * @param {string} homeAbbr
 * @param {Date|string} firstPitch UTC Date or parseable string
 * @param {Object} cfg
 * @returns {{mult:number, detail:string}}
 */
function mlbWeatherHrMultForGame_(homeAbbr, firstPitch, cfg) {
  if (!mlbWeatherEnabled_(cfg)) return { mult: 1, detail: 'weather_off' };
  const park = mlbWeatherParkForAbbr_(homeAbbr);
  if (!park) return { mult: 1, detail: 'no_park' };
  if (park.roof === 'dome') return { mult: 1, detail: 'dome' };
  const dt = firstPitch instanceof Date ? firstPitch : new Date(firstPitch);
  if (isNaN(dt.getTime())) return { mult: 1, detail: 'no_time' };
  const wx = mlbWeatherFetchAtFirstPitch_(park, dt);
  if (!wx) return { mult: 1, detail: 'no_wx' };
  const mult = mlbWeatherHrMultFromConditions_(wx, park, cfg);
  const detail =
    Math.round(wx.tempF) + '°F · ' + Math.round(wx.windMph) + 'mph@' + Math.round(wx.windFromDeg) + '°' +
    (park.roof === 'retract' ? ' · retract' : '');
  return { mult: mult, detail: detail };
}

/** Editor self-test — must not throw. @returns {string} */
function mlbWeatherSelfTest_() {
  const cfg = {};
  const parkOpenOut = { cf: 0, roof: 'open' }; // CF points North
  // Hot + wind blowing from South (180) → toward North (0) = straight out to CF.
  const hotOut = mlbWeatherHrMultFromConditions_({ tempF: 90, windMph: 15, windFromDeg: 180 }, parkOpenOut, cfg);
  if (!(hotOut > 1.05)) throw new Error('hot wind-out should boost, got ' + hotOut);
  // Cold + wind from North (0) → toward South = straight in from CF.
  const coldIn = mlbWeatherHrMultFromConditions_({ tempF: 50, windMph: 15, windFromDeg: 0 }, parkOpenOut, cfg);
  if (!(coldIn < 0.97)) throw new Error('cold wind-in should suppress, got ' + coldIn);
  // Neutral baseline.
  const neutral = mlbWeatherHrMultFromConditions_({ tempF: 70, windMph: 0, windFromDeg: 0 }, parkOpenOut, cfg);
  if (Math.abs(neutral - 1) > 1e-9) throw new Error('70°F calm should be 1.0, got ' + neutral);
  // Dome → 1.0 regardless.
  const dome = mlbWeatherHrMultForGame_('TB', new Date(), cfg);
  if (Math.abs(dome.mult - 1) > 1e-9) throw new Error('dome should be 1.0');
  return 'mlbWeatherSelfTest_: OK';
}
