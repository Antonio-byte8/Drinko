/* Disegni dei drink, usati quando il locale non ha caricato una foto.
   glass: hb (long drink) rk (tumbler) mt (coppa) sh (shot) pint (boccale) bt (bottiglia di birra o acqua) bot (bottiglia) can (lattina)
   color: colore del liquido o del corpo. garnish: decorazione (long drink, shot), bordo (coppa), etichetta (bottiglie). */
function art(glass, color, garnish) {
  var c = color || '#e9f6f2', g = garnish || '', o = 'rgba(255,255,255,.6)', w = 'rgba(255,255,255,.1)', s = '';
  var shape = function (d) { return '<path d="' + d + '" fill="' + w + '" stroke="' + o + '" stroke-width="2" stroke-linejoin="round"/>'; };
  var ice = function (x, y, n) { return '<rect x="' + x + '" y="' + y + '" width="' + n + '" height="' + n + '" rx="2" fill="#fff" opacity=".3"/>'; };
  if (glass === 'hb') {
    s = shape('M20 10H44L41 56H23Z') + '<path d="M21.6 22H42.4L41 56H23Z" fill="' + c + '" opacity=".92"/>' + ice(27, 26, 9) + ice(31, 40, 8)
      + (g ? '<circle cx="45" cy="12" r="7" fill="' + g + '"/><circle cx="45" cy="12" r="3.5" fill="#fff" opacity=".35"/>' : '');
  } else if (glass === 'rk') {
    s = shape('M14 20H50L46 56H18Z') + '<path d="M15 32H49L46 56H18Z" fill="' + c + '" opacity=".92"/>' + ice(24, 36, 12);
  } else if (glass === 'mt') {
    s = shape('M10 14H54L32 38Z') + '<path d="M15 18H49L32 34Z" fill="' + c + '"/><path d="M32 38V54M22 54H42" stroke="' + o + '" stroke-width="2.5" stroke-linecap="round"/>'
      + (g ? '<path d="M10 14H54" stroke="' + g + '" stroke-width="3.5"/>' : '');
  } else if (glass === 'sh') {
    s = shape('M22 22H42L39.5 54H24.5Z') + '<path d="M23 32H41L39.5 54H24.5Z" fill="' + c + '" opacity=".95"/>'
      + (g ? '<circle cx="43" cy="22" r="6" fill="' + g + '"/>' : '');
  } else if (glass === 'pint') {
    s = shape('M18 10H44L41 56H21Z') + '<path d="M19.6 24H42.4L41 56H21Z" fill="' + c + '"/><path d="M18.4 10H43.6L43 24H19Z" fill="#fff" opacity=".92"/>'
      + '<path d="M44 20H52V42H42" fill="none" stroke="' + o + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>';
  } else if (glass === 'bt') {
    s = '<path d="M28 6H36V22L40 30V56H24V30L28 22Z" fill="' + c + '" stroke="' + o + '" stroke-width="2" stroke-linejoin="round"/><rect x="25" y="36" width="14" height="12" fill="' + (g || '#fff') + '" opacity=".9"/>';
  } else if (glass === 'bot') {
    s = '<path d="M28 7H36V20C36 26 42 28 42 36V56H22V36C22 28 28 26 28 20Z" fill="' + c + '" stroke="' + o + '" stroke-width="2" stroke-linejoin="round"/>'
      + '<rect x="23" y="38" width="18" height="12" fill="' + (g || '#fff') + '" opacity=".92"/><rect x="28" y="4" width="8" height="5" rx="1.5" fill="' + (g || '#fff') + '"/>';
  } else if (glass === 'can') {
    s = '<rect x="21" y="12" width="22" height="42" rx="4" fill="' + c + '"/><rect x="21" y="12" width="22" height="6" rx="3" fill="#fff" opacity=".35"/>'
      + '<path d="M26 28H38M26 34H38" stroke="#fff" opacity=".6" stroke-width="2.5" stroke-linecap="round"/>';
  }
  return '<svg viewBox="0 0 64 64" role="img" aria-hidden="true">' + s + '</svg>';
}
