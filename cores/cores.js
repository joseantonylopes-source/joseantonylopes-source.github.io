// Lógica de cores do aplicativo: correção de iluminação, nome das cores,
// maturação de frutas e destaque de vermelhos e verdes.
// Funções puras, sem dependência da página, para poderem ser testadas.
(function (root) {
  'use strict';

  function toLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function toSrgb(l) {
    l = Math.min(1, Math.max(0, l));
    const c = l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
    return Math.round(c * 255);
  }

  // Tabelas de correção por canal a partir dos ganhos da calibração com branco.
  function makeLuts(gains) {
    const g = gains || [1, 1, 1];
    return g.map(function (k) {
      const t = new Uint8ClampedArray(256);
      for (let i = 0; i < 256; i++) t[i] = toSrgb(toLinear(i) * k);
      return t;
    });
  }

  // Ganhos que tornam neutra a cor medida sobre uma superfície branca.
  function gainsFromWhite(r, g, b) {
    const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
    if (Math.min(lr, lg, lb) < 0.03) return null; // escuro demais para calibrar
    const m = (lr + lg + lb) / 3;
    return [m / lr, m / lg, m / lb];
  }

  function hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d > 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h: h, s: max === 0 ? 0 : d / max, v: max };
  }

  // Grupos de cor por faixa de matiz (graus).
  const FAMILIES = [
    { key: 'vermelho', from: 345, to: 12 },
    { key: 'laranja', label: 'laranja / marrom', from: 12, to: 40 },
    { key: 'amarelo', label: 'amarelo / oliva', from: 40, to: 66 },
    { key: 'amarelo-esverdeado', from: 66, to: 85 },
    { key: 'verde', from: 85, to: 165 },
    { key: 'verde-azulado', from: 165, to: 195 },
    { key: 'azul', from: 195, to: 255 },
    { key: 'roxo', from: 255, to: 290 },
    { key: 'rosa', from: 290, to: 345 }
  ];

  function inRange(h, f) {
    return f.from < f.to ? h >= f.from && h < f.to : h >= f.from || h < f.to;
  }

  function familyIndex(h) {
    for (let i = 0; i < FAMILIES.length; i++) if (inRange(h, FAMILIES[i])) return i;
    return 0;
  }

  function angleDist(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  function specificName(fam, s, v) {
    switch (fam) {
      case 'vermelho':
        if (v < 0.45) return 'vinho (vermelho-escuro)';
        if (s < 0.5 && v > 0.65) return 'rosa';
        return 'vermelho';
      case 'laranja':
        if (v < 0.6) return 'marrom';
        if (s < 0.4) return 'bege';
        if (s < 0.6 && v < 0.85) return 'marrom-claro (caramelo)';
        return 'laranja';
      case 'amarelo':
        if (v < 0.55) return 'verde-oliva';
        if (s < 0.35) return 'creme';
        return 'amarelo';
      case 'amarelo-esverdeado':
        if (v < 0.45) return 'verde-oliva';
        return 'amarelo-esverdeado';
      case 'verde':
        if (v < 0.4) return 'verde-escuro';
        if (s < 0.35 && v > 0.7) return 'verde-claro';
        return 'verde';
      case 'verde-azulado':
        if (v < 0.4) return 'verde-azulado escuro';
        return 'verde-azulado (turquesa)';
      case 'azul':
        if (v < 0.4) return 'azul-marinho';
        if (s < 0.4 && v > 0.7) return 'azul-claro';
        return 'azul';
      case 'roxo':
        if (v < 0.4) return 'roxo-escuro';
        if (s < 0.4 && v > 0.65) return 'lilás';
        return 'roxo';
      default: // rosa
        if (v < 0.45) return 'ameixa (roxo-avermelhado)';
        if (s < 0.6) return 'rosa';
        return 'rosa-choque (magenta)';
    }
  }

  // Nome da cor a partir de r, g, b já corrigidos (0 a 255).
  function nameColor(r, g, b) {
    const c = hsv(r, g, b);
    const chroma = c.s * c.v;
    if (c.v < 0.12) return { name: 'preto', group: 'neutro (sem cor)', alt: null, hsv: c };
    if (c.s < 0.12 || chroma < 0.06) {
      let name;
      if (c.v < 0.3) name = 'cinza-escuro';
      else if (c.v < 0.6) name = 'cinza';
      else if (c.v < 0.82) name = 'cinza-claro';
      else name = 'branco';
      return { name: name, group: 'neutro (sem cor)', alt: null, hsv: c };
    }
    const i = familyIndex(c.h);
    const fam = FAMILIES[i];
    let alt = null;
    if (angleDist(c.h, fam.from) < 5) alt = FAMILIES[(i + FAMILIES.length - 1) % FAMILIES.length].key;
    else if (angleDist(c.h, fam.to) < 5) alt = FAMILIES[(i + 1) % FAMILIES.length].key;
    if (!alt && chroma < 0.1) alt = 'cinza';
    return { name: specificName(fam.key, c.s, c.v), group: fam.label || fam.key, alt: alt, hsv: c };
  }

  // Média de uma região, ignorando reflexos estourados.
  function averageRegion(data, width, x0, y0, w, h, luts) {
    let r = 0, g = 0, b = 0, n = 0, rAll = 0, gAll = 0, bAll = 0, nAll = 0;
    const L = luts || makeLuts();
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const k = (y * width + x) * 4;
        const R = L[0][data[k]], G = L[1][data[k + 1]], B = L[2][data[k + 2]];
        rAll += R; gAll += G; bAll += B; nAll++;
        if (data[k] > 250 && data[k + 1] > 250 && data[k + 2] > 250) continue;
        r += R; g += G; b += B; n++;
      }
    }
    if (n < nAll * 0.3) { r = rAll; g = gAll; b = bAll; n = nAll; }
    if (!n) return null;
    // Variação dentro da área, para avisar quando há várias cores misturadas.
    const mr = r / n, mg = g / n, mb = b / n;
    let dev = 0;
    for (let y = y0; y < y0 + h; y += 2) {
      for (let x = x0; x < x0 + w; x += 2) {
        const k = (y * width + x) * 4;
        dev += Math.abs(L[0][data[k]] - mr) + Math.abs(L[1][data[k + 1]] - mg) + Math.abs(L[2][data[k + 2]] - mb);
      }
    }
    dev /= Math.max(1, Math.ceil(w / 2) * Math.ceil(h / 2)) * 3;
    return { r: mr, g: mg, b: mb, spread: dev };
  }

  // Conta pixels verdes, amarelos e manchas escuras dentro de um retângulo.
  function fruitCounts(data, width, x0, y0, w, h, luts) {
    const L = luts || makeLuts();
    let green = 0, yellow = 0, spot = 0, total = 0;
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const k = (y * width + x) * 4;
        total++;
        const c = hsv(L[0][data[k]], L[1][data[k + 1]], L[2][data[k + 2]]);
        if (c.v < 0.3 || (c.h >= 8 && c.h < 45 && c.v < 0.55 && c.s > 0.3)) { spot++; continue; }
        if (c.s < 0.2) continue; // fundo branco ou cinza
        if (c.h >= 68 && c.h < 170) green++;
        else if (c.h >= 62 && c.h < 68) { green += 0.5; yellow += 0.5; }
        else if (c.h < 62 || c.h >= 340) yellow++;
      }
    }
    return { green: green, yellow: yellow, spot: spot, total: total };
  }

  function pct(x) { return Math.round(x * 100) + '%'; }

  function ripeness(fruit, counts) {
    const fruitPx = counts.green + counts.yellow + counts.spot;
    if (fruitPx < counts.total * 0.25) {
      return { ok: false, title: 'Fruta não encontrada', text: 'Aproxime o celular até a casca preencher o retângulo.' };
    }
    const gF = counts.green / fruitPx, yF = counts.yellow / fruitPx, sF = counts.spot / fruitPx;
    const detail = 'Verde ' + pct(gF) + ' · Amarela ' + pct(yF) + ' · Manchas escuras ' + pct(sF);
    let title, text, stage;
    if (fruit === 'banana') {
      if (gF >= 0.55) { stage = 1; title = 'Verde'; text = 'Ainda não está madura. Costuma amadurecer em alguns dias fora da geladeira.'; }
      else if (gF >= 0.2) { stage = 2; title = 'Quase madura'; text = 'Amarela com partes verdes. Deve ficar no ponto em um ou dois dias.'; }
      else if (sF < 0.06) { stage = 3; title = 'Madura'; text = 'Amarela. Está no ponto para comer.'; }
      else if (sF < 0.3) { stage = 4; title = 'Madura, com pintas'; text = 'Mais doce e mais macia. Boa para comer logo.'; }
      else { stage = 5; title = 'Muito madura'; text = 'Muitas manchas escuras. Boa para bolo, vitamina ou doce.'; }
    } else {
      const toque = ' Confirme apertando de leve a parte estreita perto do cabo: se ceder um pouco, está madura; se estiver dura, espere alguns dias.';
      if (gF >= 0.6) { stage = 1; title = 'Casca verde'; text = 'Muitas variedades de pera continuam verdes mesmo maduras, então a cor não basta.' + toque; }
      else if (gF >= 0.25) { stage = 2; title = 'Casca verde-amarelada'; text = 'A casca está começando a amarelar.' + toque; }
      else { stage = 3; title = 'Casca amarelada'; text = 'Nas peras que mudam de cor, como a Williams, indica fruta madura.' + toque; }
      if (sF >= 0.25) text += ' Há muitas manchas escuras: verifique se não há partes moles ou machucadas.';
    }
    return { ok: true, stage: stage, title: title, text: text, detail: detail };
  }

  function isRed(c) { return (c.h < 18 || c.h >= 338) && c.s > 0.35 && c.v > 0.18; }
  function isGreen(c) { return c.h >= 75 && c.h < 170 && c.s > 0.22 && c.v > 0.12; }

  // Aplica a correção e marca vermelhos com listras diagonais e verdes com
  // listras horizontais, em preto e branco. Retorna a fração de cada um.
  function highlight(img, luts, target) {
    const d = img.data, w = img.width, h = img.height;
    const L = luts || makeLuts();
    let reds = 0, greens = 0;
    const wantRed = target !== 'verde', wantGreen = target !== 'vermelho';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = (y * w + x) * 4;
        const R = L[0][d[k]], G = L[1][d[k + 1]], B = L[2][d[k + 2]];
        d[k] = R; d[k + 1] = G; d[k + 2] = B;
        const c = hsv(R, G, B);
        let mark = -1;
        if (wantRed && isRed(c)) { reds++; mark = ((x + y) >> 2) & 1; }
        else if (wantGreen && isGreen(c)) { greens++; mark = (y >> 2) & 1; }
        if (mark >= 0) { const val = mark ? 255 : 0; d[k] = d[k + 1] = d[k + 2] = val; }
      }
    }
    const n = w * h;
    return { red: reds / n, green: greens / n };
  }


  // ---------- Camisa e gravata ----------
  // Categorias de cor de roupa, com o nome no feminino (camisa, gravata).
  const LABEL = {
    'branco': 'branca', 'cinza-claro': 'cinza-clara (prata)', 'cinza': 'cinza', 'preto': 'preta',
    'azul-claro': 'azul-clara', 'azul': 'azul', 'azul-marinho': 'azul-marinho', 'turquesa': 'turquesa',
    'rosa': 'rosa', 'lilás': 'lilás', 'roxo': 'roxa', 'vermelho': 'vermelha', 'vinho': 'vinho (bordô)',
    'bege': 'bege', 'marrom': 'marrom', 'laranja': 'laranja', 'amarelo': 'amarela (mostarda)',
    'verde': 'verde', 'verde-oliva': 'verde-oliva'
  };

  function categorize(r, g, b) {
    const c = hsv(r, g, b), n = nameColor(r, g, b);
    if (n.group === 'neutro (sem cor)') {
      if (n.name === 'preto') return 'preto';
      if (n.name === 'branco') return 'branco';
      if (n.name === 'cinza-claro') return 'cinza-claro';
      return c.v < 0.2 ? 'preto' : 'cinza';
    }
    switch (FAMILIES[familyIndex(c.h)].key) {
      case 'vermelho': return c.v < 0.5 ? 'vinho' : (c.s < 0.5 && c.v > 0.65 ? 'rosa' : 'vermelho');
      case 'laranja': return c.v < 0.6 ? 'marrom' : (c.s < 0.4 ? 'bege' : 'laranja');
      case 'amarelo': return c.v < 0.55 ? 'verde-oliva' : (c.s < 0.35 ? 'bege' : 'amarelo');
      case 'amarelo-esverdeado': return c.v < 0.45 ? 'verde-oliva' : 'verde';
      case 'verde': return 'verde';
      case 'verde-azulado': return 'turquesa';
      case 'azul': return c.v < 0.45 ? 'azul-marinho' : (c.s < 0.45 && c.v > 0.65 ? 'azul-claro' : 'azul');
      case 'roxo': return c.s < 0.4 && c.v > 0.65 ? 'lilás' : 'roxo';
      default: return c.v < 0.45 ? 'vinho' : 'rosa';
    }
  }

  // Combinações usuais no vestuário masculino: gravatas recomendadas (em ordem)
  // e gravatas a evitar, para cada cor de camisa.
  const TIES = {
    'branco': { good: ['azul-marinho', 'vinho', 'vermelho', 'azul', 'cinza', 'roxo', 'amarelo', 'preto'], avoid: ['branco', 'bege', 'cinza-claro'],
      note: 'Camisa branca combina com quase todas as gravatas.' },
    'cinza-claro': { good: ['azul-marinho', 'vinho', 'roxo', 'azul', 'rosa', 'vermelho', 'preto'], avoid: ['cinza-claro', 'branco', 'bege'] },
    'cinza': { good: ['vinho', 'azul-marinho', 'roxo', 'rosa', 'lilás', 'preto'], avoid: ['cinza', 'marrom', 'bege'] },
    'preto': { good: ['cinza-claro', 'branco', 'vinho', 'cinza'], avoid: ['azul-marinho', 'marrom'] },
    'azul-claro': { good: ['azul-marinho', 'vinho', 'vermelho', 'amarelo', 'cinza', 'rosa', 'roxo', 'marrom'], avoid: ['azul-claro', 'turquesa', 'verde', 'branco'] },
    'azul': { good: ['amarelo', 'vinho', 'cinza-claro', 'rosa', 'azul-marinho', 'laranja'], avoid: ['azul', 'turquesa', 'verde'] },
    'azul-marinho': { good: ['amarelo', 'cinza-claro', 'rosa', 'lilás', 'vinho', 'azul-claro'], avoid: ['azul-marinho', 'preto', 'marrom'] },
    'turquesa': { good: ['azul-marinho', 'cinza', 'marrom'], avoid: ['turquesa', 'verde', 'azul'] },
    'rosa': { good: ['azul-marinho', 'cinza', 'vinho', 'roxo', 'azul'], avoid: ['rosa', 'vermelho', 'laranja', 'amarelo'] },
    'lilás': { good: ['roxo', 'cinza', 'azul-marinho', 'vinho'], avoid: ['lilás', 'laranja', 'verde', 'amarelo'] },
    'roxo': { good: ['cinza-claro', 'cinza', 'lilás', 'preto', 'azul-marinho'], avoid: ['roxo', 'laranja', 'verde', 'vermelho'] },
    'vermelho': { good: ['cinza', 'preto', 'azul-marinho', 'branco'], avoid: ['vermelho', 'rosa', 'laranja', 'verde', 'roxo'] },
    'vinho': { good: ['cinza-claro', 'cinza', 'rosa', 'azul-marinho'], avoid: ['vinho', 'vermelho', 'verde', 'laranja'] },
    'bege': { good: ['marrom', 'azul-marinho', 'verde-oliva', 'vinho', 'verde'], avoid: ['bege', 'amarelo', 'branco', 'cinza-claro'] },
    'marrom': { good: ['bege', 'azul-marinho', 'verde-oliva', 'laranja', 'amarelo'], avoid: ['marrom', 'preto', 'roxo'] },
    'laranja': { good: ['azul-marinho', 'marrom', 'cinza', 'azul'], avoid: ['laranja', 'vermelho', 'rosa', 'roxo'] },
    'amarelo': { good: ['azul-marinho', 'roxo', 'cinza', 'marrom', 'azul'], avoid: ['amarelo', 'laranja', 'bege', 'verde'] },
    'verde': { good: ['vinho', 'azul-marinho', 'marrom', 'amarelo', 'cinza'], avoid: ['verde', 'vermelho', 'verde-oliva', 'turquesa'] },
    'verde-oliva': { good: ['vinho', 'marrom', 'bege', 'azul-marinho', 'laranja'], avoid: ['verde-oliva', 'verde', 'preto'] }
  };

  function labels(list) { return list.map(function (k) { return LABEL[k]; }).join(', '); }

  // Cor oposta no círculo cromático (complementar), só para cores com matiz.
  function complement(r, g, b) {
    const c = hsv(r, g, b), n = nameColor(r, g, b);
    if (n.group === 'neutro (sem cor)' || c.s < 0.2) return null;
    return FAMILIES[familyIndex((c.h + 180) % 360)].key;
  }

  function shirtAdvice(r, g, b) {
    const cat = categorize(r, g, b), t = TIES[cat];
    return { cat: cat, label: LABEL[cat], good: labels(t.good), avoid: labels(t.avoid), note: t.note || '', complement: complement(r, g, b) };
  }

  function tieVerdict(shirtCat, tieRgb, shirtRgb) {
    const tieCat = categorize(tieRgb.r, tieRgb.g, tieRgb.b), t = TIES[shirtCat];
    const base = { tieCat: tieCat, tieLabel: LABEL[tieCat] };
    if (t.good.indexOf(tieCat) >= 0) return Object.assign(base, { level: 'bom', verdict: 'combina bem', reason: 'É uma combinação clássica com camisa ' + LABEL[shirtCat] + '.' });
    if (t.avoid.indexOf(tieCat) >= 0) {
      const why = tieCat === shirtCat ? 'A gravata quase se confunde com a camisa.' : 'Não é uma combinação recomendada com camisa ' + LABEL[shirtCat] + '.';
      return Object.assign(base, { level: 'evitar', verdict: 'melhor evitar', reason: why });
    }
    const dv = Math.abs(hsv(tieRgb.r, tieRgb.g, tieRgb.b).v - hsv(shirtRgb.r, shirtRgb.g, shirtRgb.b).v);
    if (dv < 0.1) return Object.assign(base, { level: 'possivel', verdict: 'combinação possível', reason: 'Pouco contraste de claro e escuro com a camisa; prefira uma gravata mais escura ou mais clara.' });
    return Object.assign(base, { level: 'possivel', verdict: 'combinação possível', reason: 'Não é uma das mais clássicas, mas pode funcionar.' });
  }

  const api = {
    toLinear: toLinear, toSrgb: toSrgb, makeLuts: makeLuts, gainsFromWhite: gainsFromWhite,
    hsv: hsv, nameColor: nameColor, averageRegion: averageRegion,
    fruitCounts: fruitCounts, ripeness: ripeness, highlight: highlight,
    categorize: categorize, shirtAdvice: shirtAdvice, tieVerdict: tieVerdict, TIES: TIES, LABEL: LABEL
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Cores = api;
})(this);
