// Deshacer: guarda lo último que se hizo con cómo volver atrás, para corregir errores.
// Cada acción que se puede deshacer se anota con registrar({ texto, deshacer }); después se deshace con el
// aviso "Deshacer" que aparece al hacerla, con el botón de la barra o con Ctrl+Z. Se guardan las últimas 30
// acciones de esta sesión (se pierden al recargar la página o al salir).
// Funciona igual en el navegador (window.Deshacer) y en Node (require).
(function (global) {
  'use strict';

  const MAXIMO = 30;

  // notificar(mensaje, tipo): cómo avisarle a la persona (en la página, el aviso breve)
  function crear(notificar) {
    const pila = [];
    const oyentes = [];
    let secuencia = 0;
    const avisar = (m, t) => { if (notificar) notificar(m, t); };
    const cambio = () => oyentes.forEach(f => f());

    const api = {
      // entrada: { texto: "Marcar foto en 3 artículos", deshacer: async () => { … } }. Devuelve su id.
      registrar(entrada) {
        const e = { id: ++secuencia, texto: String(entrada.texto || 'la última acción'), fn: entrada.deshacer };
        pila.push(e);
        if (pila.length > MAXIMO) pila.shift();
        cambio();
        return e.id;
      },
      hay: () => pila.length > 0,
      cantidad: () => pila.length,
      ultimo: () => pila[pila.length - 1] || null,
      // Deshace una acción puntual (la del aviso, o la de una tarjeta). Si falla, queda anotada para reintentar.
      async ejecutar(id) {
        const i = pila.findIndex(e => e.id === id);
        if (i < 0) return false;
        const [e] = pila.splice(i, 1);
        cambio();
        try {
          await e.fn();
          avisar('Deshecho: ' + e.texto, 'ok');
          return true;
        } catch (err) {
          pila.splice(i, 0, e);
          cambio();
          avisar('No se pudo deshacer: ' + ((err && err.message) || err), 'error');
          return false;
        }
      },
      async deshacerUltimo() {
        const u = api.ultimo();
        if (!u) { avisar('No hay nada para deshacer.', 'ok'); return false; }
        return api.ejecutar(u.id);
      },
      alCambiar(f) { oyentes.push(f); },
      vaciar() { pila.length = 0; cambio(); },
    };
    return api;
  }

  const api = { crear, MAXIMO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Deshacer = api;
})(typeof window !== 'undefined' ? window : globalThis);
