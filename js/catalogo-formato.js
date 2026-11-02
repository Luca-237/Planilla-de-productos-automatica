// Formato del catálogo de ingresos (el que sale de Manager como "Catálogo de ingresos"):
// hoja A4 vertical con 4 tarjetas (2 × 2). Cada tarjeta: fondo gris, nombre del artículo
// arriba y centrado, foto cuadrada con fondo blanco, "CÓD. 123456" abajo a la izquierda y una
// píldora negra a la derecha con el precio ("$ 1,200 +IVA").
// Genera el mismo diseño en PDF (jsPDF) y en PowerPoint (PptxGenJS, con formas y textos editables).
// Funciona igual en el navegador (window.CatalogoFormato) y en Node (require).
// items: [{ codigo, nombre, precio (número o null), foto (data URL o null), fotoAncho, fotoAlto, fotoFormato ("JPEG" | "PNG") }]
// opciones: { mostrarPrecio (true), mostrarIva (true) }
(function (global) {
  'use strict';

  // ---------- Medidas (mm), tomadas del catálogo de ejemplo ----------
  const HOJA = { ancho: 210, alto: 297 };
  const MARGEN = 2, ESPACIO = 1.5;
  const TARJETA = { ancho: (HOJA.ancho - 2 * MARGEN - ESPACIO) / 2, alto: (HOJA.alto - 2 * MARGEN - ESPACIO) / 2 };
  const POR_HOJA = 4;
  const L = {
    tituloY: 8.5,                              // centro del nombre
    fotoX: 2.8, fotoY: 17.4,                   // la foto es cuadrada: el ancho de la tarjeta menos los márgenes
    codigoX: 4.5, codigoY: 118.2,              // centro del "CÓD."
    pildoraX: 57.8, pildoraY: 117.2, pildoraAlto: 14, // llega hasta el borde derecho de la tarjeta
  };
  L.fotoLado = TARJETA.ancho - 2 * L.fotoX;
  const COLORES = { tarjeta: 'E8E8E8', foto: 'FFFFFF', negro: '000000', blanco: 'FFFFFF' };

  const hojasDe = n => Math.max(1, Math.ceil(n / POR_HOJA));
  const posicion = i => {
    const k = i % POR_HOJA, col = k % 2, fila = Math.floor(k / 2);
    return { x: MARGEN + col * (TARJETA.ancho + ESPACIO), y: MARGEN + fila * (TARJETA.alto + ESPACIO) };
  };

  // "$ 1,200" (con coma de miles, como el catálogo de ejemplo)
  const textoPrecio = n => '$ ' + Math.round(n).toLocaleString('en-US');
  const tieneFoto = it => !!(it.foto && it.fotoAncho > 0 && it.fotoAlto > 0);
  // La foto entra entera dentro del cuadrado, centrada
  function encajar(it) {
    const lado = L.fotoLado, r = Math.min(lado / it.fotoAncho, lado / it.fotoAlto);
    const w = it.fotoAncho * r, h = it.fotoAlto * r;
    return { x: (lado - w) / 2, y: (lado - h) / 2, w, h };
  }

  // ---------- PDF ----------
  function crearPDF(jsPDF, items, opciones = {}) {
    const op = Object.assign({ mostrarPrecio: true, mostrarIva: true }, opciones);
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    const rgb = hex => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    const relleno = h => doc.setFillColor(...rgb(h));
    const texto = h => doc.setTextColor(...rgb(h));

    for (let h = 0; h < hojasDe(items.length); h++) {
      if (h > 0) doc.addPage();
      items.slice(h * POR_HOJA, (h + 1) * POR_HOJA).forEach((it, k) => {
        const { x, y } = posicion(k);
        // tarjeta
        relleno(COLORES.tarjeta); doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5);
        doc.rect(x, y, TARJETA.ancho, TARJETA.alto, 'FD');
        // nombre
        texto(COLORES.negro); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
        doc.text(String(it.nombre || '').toUpperCase(), x + TARJETA.ancho / 2, y + L.tituloY, { align: 'center', baseline: 'middle', maxWidth: TARJETA.ancho - 8 });
        // foto
        relleno(COLORES.foto);
        doc.rect(x + L.fotoX, y + L.fotoY, L.fotoLado, L.fotoLado, 'F');
        if (tieneFoto(it)) {
          const p = encajar(it);
          doc.addImage(it.foto, it.fotoFormato || 'JPEG', x + L.fotoX + p.x, y + L.fotoY + p.y, p.w, p.h);
        } else {
          texto('9A9A9A'); doc.setFont('helvetica', 'normal'); doc.setFontSize(12);
          doc.text('Sin foto', x + L.fotoX + L.fotoLado / 2, y + L.fotoY + L.fotoLado / 2, { align: 'center', baseline: 'middle' });
        }
        // código
        texto(COLORES.negro); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
        doc.text('CÓD. ' + it.codigo, x + L.codigoX, y + L.codigoY, { baseline: 'middle' });
        // precio: píldora negra redondeada a la izquierda y cortada en el borde de la tarjeta
        if (op.mostrarPrecio && it.precio != null) {
          const px = x + L.pildoraX, py = y + L.pildoraY, r = L.pildoraAlto / 2;
          relleno(COLORES.negro);
          doc.circle(px + r, py + r, r, 'F');
          doc.rect(px + r, py, x + TARJETA.ancho - (px + r) - 0.25, L.pildoraAlto, 'F');
          texto(COLORES.blanco); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
          const t = textoPrecio(it.precio);
          doc.text(t, px + 12, py + r, { baseline: 'middle' });
          if (op.mostrarIva) {
            const w = doc.getTextWidth(t);
            doc.setFontSize(5.5); doc.text('+IVA', px + 12 + w + 0.6, py + r + 1.2, { baseline: 'middle' });
          }
        }
      });
    }
    return doc;
  }

  // ---------- PowerPoint ----------
  const pulg = mm => mm / 25.4;
  function crearPPTX(PptxGenJS, items, opciones = {}) {
    const op = Object.assign({ mostrarPrecio: true, mostrarIva: true }, opciones);
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'A4_VERTICAL', width: pulg(HOJA.ancho), height: pulg(HOJA.alto) });
    pptx.layout = 'A4_VERTICAL';
    const caja = (x, y, w, h) => ({ x: pulg(x), y: pulg(y), w: pulg(w), h: pulg(h) });

    for (let h = 0; h < hojasDe(items.length); h++) {
      const slide = pptx.addSlide();
      slide.background = { color: 'FFFFFF' };
      items.slice(h * POR_HOJA, (h + 1) * POR_HOJA).forEach((it, k) => {
        const { x, y } = posicion(k);
        slide.addShape(pptx.ShapeType.rect, { ...caja(x, y, TARJETA.ancho, TARJETA.alto), fill: { color: COLORES.tarjeta }, line: { color: COLORES.negro, width: 1.5 } });
        slide.addText(String(it.nombre || '').toUpperCase(), {
          ...caja(x + 4, y + L.tituloY - 4, TARJETA.ancho - 8, 8), fontFace: 'Arial', fontSize: 11, bold: true, color: COLORES.negro, align: 'center', valign: 'middle', margin: 0, fit: 'shrink',
        });
        slide.addShape(pptx.ShapeType.rect, { ...caja(x + L.fotoX, y + L.fotoY, L.fotoLado, L.fotoLado), fill: { color: COLORES.foto }, line: { color: COLORES.foto, width: 0 } });
        if (tieneFoto(it)) {
          const p = encajar(it);
          slide.addImage({ data: it.foto, ...caja(x + L.fotoX + p.x, y + L.fotoY + p.y, p.w, p.h) });
        } else {
          slide.addText('Sin foto', { ...caja(x + L.fotoX, y + L.fotoY, L.fotoLado, L.fotoLado), fontFace: 'Arial', fontSize: 12, color: '9A9A9A', align: 'center', valign: 'middle', margin: 0 });
        }
        slide.addText('CÓD. ' + it.codigo, { ...caja(x + L.codigoX, y + L.codigoY - 4, 52, 8), fontFace: 'Arial', fontSize: 11, bold: true, color: COLORES.negro, align: 'left', valign: 'middle', margin: 0 });
        if (op.mostrarPrecio && it.precio != null) {
          const px = x + L.pildoraX, py = y + L.pildoraY, r = L.pildoraAlto / 2;
          slide.addShape(pptx.ShapeType.ellipse, { ...caja(px, py, L.pildoraAlto, L.pildoraAlto), fill: { color: COLORES.negro }, line: { color: COLORES.negro, width: 0 } });
          slide.addShape(pptx.ShapeType.rect, { ...caja(px + r, py, x + TARJETA.ancho - (px + r) - 0.25, L.pildoraAlto), fill: { color: COLORES.negro }, line: { color: COLORES.negro, width: 0 } });
          const runs = [{ text: textoPrecio(it.precio), options: { fontSize: 15, bold: true, color: COLORES.blanco } }];
          if (op.mostrarIva) runs.push({ text: ' +IVA', options: { fontSize: 5.5, bold: true, color: COLORES.blanco } });
          slide.addText(runs, { ...caja(px + 12, py, TARJETA.ancho - L.pildoraX - 12, L.pildoraAlto), fontFace: 'Arial', align: 'left', valign: 'middle', margin: 0 });
        }
      });
    }
    return pptx;
  }

  const api = { crearPDF, crearPPTX, textoPrecio, hojasDe, POR_HOJA, _medidas: { HOJA, TARJETA, L } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.CatalogoFormato = api;
})(typeof window !== 'undefined' ? window : globalThis);
