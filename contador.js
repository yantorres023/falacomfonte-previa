// Mostra aparelhos únicos e pessoas online. Qualquer falha (sem servidor, erro, número inválido) oculta o contador.
(function () {
  var alvo = document.getElementById('contador');
  if (!alvo || !window.fetch) return;
  var id;
  try {
    id = localStorage.getItem('ffid');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('ffid', id); }
  } catch (e) {
    id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : null;
  }
  if (!id) return;
  var css = document.querySelector('link[rel=stylesheet][href$="estilo.css"]');
  var base = css ? css.getAttribute('href').replace(/estilo\.css$/, '') : '';
  var fmt = new Intl.NumberFormat('pt-BR');
  function ocultar() { alvo.hidden = true; alvo.textContent = ''; }
  function valido(n) { return typeof n === 'number' && isFinite(n) && n >= 0 && Math.floor(n) === n; }
  function pulsar() {
    if (document.visibilityState === 'hidden') return;
    fetch(base + 'api/contador', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !valido(d.unicos) || !valido(d.online)) return ocultar();
        alvo.textContent = fmt.format(d.online) + ' online agora · ' + fmt.format(d.unicos) +
          (d.unicos === 1 ? ' aparelho único' : ' aparelhos únicos');
        alvo.hidden = false;
      })
      .catch(ocultar);
  }
  pulsar();
  setInterval(pulsar, 60000);
  document.addEventListener('visibilitychange', pulsar);
})();
