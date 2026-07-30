var q = document.getElementById('q');
var count = document.getElementById('count');
var empty = document.getElementById('empty');
var rows = [].slice.call(document.querySelectorAll('.row'));
var sections = [].slice.call(document.querySelectorAll('section[data-layer]'));
var chipEls = [].slice.call(document.querySelectorAll('.chip'));
var layer = null;

function paintChips() {
  chipEls.forEach(function (c) {
    c.setAttribute('aria-pressed', String(layer === c.dataset.chip));
  });
}

// Tokenise once, not per keystroke.
rows.forEach(function (r) { r._t = r.dataset.s.split(/[\s·]+/).filter(Boolean); });

/**
 * A term matches if some token STARTS WITH it, or — for terms of three
 * characters or more — if it appears anywhere in the row.
 *
 * Plain substring matching was measured on the finished page and it was far too
 * loose: "cmd t" returned 160 of 225 rows, because a bare "t" matches inside
 * "ctrl", "option" and "shift". Prefix-on-token makes one- and two-character
 * terms behave like the key they obviously mean, while longer terms stay
 * forgiving enough that "config" still finds "reload-config".
 */
function matches(r, term) {
  for (var i = 0; i < r._t.length; i++) {
    if (r._t[i].lastIndexOf(term, 0) === 0) return true;
  }
  return term.length >= 3 && r.dataset.s.indexOf(term) !== -1;
}

function apply() {
  var terms = q.value.toLowerCase().split(/\s+/).filter(Boolean);
  var n = 0;
  rows.forEach(function (r) {
    // A layer filter must not hide the dead-binding warnings for that layer,
    // so conflicts match on their loser layer and stay visible.
    var okLayer = !layer || r.dataset.l === layer;
    var okTerms = terms.every(function (t) { return matches(r, t); });
    var show = okLayer && okTerms;
    r.hidden = !show;
    // The "lo esencial" strip re-shows nine aerospace bindings, so counting
    // every .row read "234 de 225" — more shown than exist. Only rows that are
    // the canonical listing of a binding are counted.
    if (show && !('dup' in r.dataset)) n++;
  });
  sections.forEach(function (s) {
    s.hidden = !s.querySelector('.row:not([hidden])');
  });
  count.textContent = n;
  empty.hidden = n !== 0;
}

q.addEventListener('input', apply);
chipEls.forEach(function (c) {
  c.addEventListener('click', function () {
    layer = layer === c.dataset.chip ? null : c.dataset.chip;
    paintChips();
    apply();
  });
});
document.addEventListener('keydown', function (e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '/' && document.activeElement !== q) {
    e.preventDefault();
    q.focus();
    q.select();
  } else if (e.key === 'Escape') {
    q.value = '';
    layer = null;
    paintChips();
    apply();
  }
});
apply();
