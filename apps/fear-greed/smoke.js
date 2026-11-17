/**
 * @file smoke.js
 * @description Essai manuel du pipeline complet : collecte réelle → dominance → dataset
 *              → 1 époque des deux modèles → inférence → chemin de bougies futures
 *              → sauvegarde/rechargement des poids.
 * Utilisation : node smoke.js
 */

const tf = require('@tensorflow/tfjs');
const market = require('./market');
const indicators = require('./indicators');
const sentiment = require('./sentiment');
const store = require('./store');

(async () => {
  await sentiment.init();
  // 12 jours : suffit pour la fenêtre 24 h + horizon 7 jours (le serveur télécharge 90 jours)
  const { source, candles } = await market.fetchCandles(12);
  const { pct } = await market.fetchDominance();
  const dominance = { pct, changePct: 0 };
  const fg = indicators.fearGreed(candles, dominance);
  console.log(`Source : ${source} | bougies : ${candles.length} | dominance BTC : ${pct.toFixed(2)} %`);
  console.log(`Dernier prix : ${fg.price.toFixed(2)} $ | variation 24 h : ${(fg.changePct24h * 100).toFixed(2)} %`);
  console.log(`Indice Fear & Greed : ${fg.score}/100 (${fg.label}) — ${fg.components.length} composantes`);
  fg.components.forEach(c => console.log(`  - ${c.label} : ${c.score.toFixed(0)} (${c.raw})`));

  const info = sentiment.prepareData(candles);
  console.log(`Datasets : classifieur ${info.classifier} exemples, prévisionniste ${info.forecaster} exemples (fenêtre ${info.window} h, ${info.features} features)`);
  console.log(`Paramètres : classifieur ${sentiment.stats().classifierParams} + prévisionniste ${sentiment.stats().forecasterParams}`);

  const metrics = await sentiment.trainEpoch();
  console.log(`Époque 1 direction : loss ${metrics.direction.loss.toFixed(4)} | acc train ${(metrics.direction.accuracy * 100).toFixed(1)} % | acc test ${(metrics.direction.testAccuracy * 100).toFixed(1)} %`);
  console.log(`Époque 1 prévision : loss ${metrics.forecast.loss.toFixed(6)} | MAE prix ${metrics.forecast.maePct.toFixed(2)} %`);

  const { probaUp } = sentiment.predict(candles);
  console.log(`P(hausse prochaine heure) : ${(probaUp * 100).toFixed(1)} % → ${sentiment.sentimentLabel(probaUp).label}`);

  const path = sentiment.forecastPath(candles);
  console.log(`Chemin de ${path.steps.length} bougies futures (rollout) :`);
  [0, 3, 11].forEach(idx => {
    const s = path.steps[idx];
    console.log(`  +${idx + 1} h : ${s.price.toFixed(2)} $ (${s.retPct >= 0 ? '+' : ''}${s.retPct.toFixed(2)} %)`);
  });

  // Prévision directe à une semaine (sortie +168 h, sans rollout)
  const weekly = sentiment.weeklyForecast(candles);
  console.log(`Prévision +7 jours (direct) : ${weekly.price.toFixed(2)} $ (${weekly.retPct >= 0 ? '+' : ''}${weekly.retPct.toFixed(2)} %)`);

  // Prévision rétrospective : ce que le modèle prévoyait il y a 24 h vs réalité
  const bt = sentiment.backtest(candles);
  if (bt) {
    let maeSum = 0;
    bt.steps.forEach((s, i) => { maeSum += Math.abs(s.price - bt.actual[i].price) / bt.actual[i].price; });
    console.log(`Backtest 24 h : MAE ${(maeSum / bt.steps.length * 100).toFixed(2)} % (prédit il y a 24 h vs réel)`);
  }

  // Sauvegarde puis rechargement des poids
  const saved = await sentiment.saveModels();
  console.log(`Poids sauvegardés : ${saved.classifier.replace(store.DATA_DIR, 'data')} | ${saved.forecaster.replace(store.DATA_DIR, 'data')}`);
  const restored = await sentiment.loadModels();
  console.log(`Rechargement : ${restored ? 'OK' : 'ÉCHEC'}`);
  const { probaUp: proba2 } = sentiment.predict(candles);
  console.log(`P(hausse) après rechargement : ${(proba2 * 100).toFixed(1)} % (identique attendu)`);
  tf.dispose();
})().catch(err => { console.error(err); process.exit(1); });
