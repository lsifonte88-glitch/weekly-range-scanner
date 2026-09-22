# Smart Money V2

La capa Smart Money ahora combina señales de mercado con fuentes de dinero informado y deja claro cuándo una fuente no está configurada.

## Incluido en V2

- SEC Forms 3/4/5: compras y ventas de insiders.
- SEC 13F: muestra de posiciones institucionales de gestores configurados, con fecha del trimestre y del filing.
- Congreso: adaptador Quiver Quantitative mediante `QUIVER_API_KEY`, o proveedor compatible mediante `CONGRESS_API_URL`.
- Actividad inusual: RVOL, volumen en dólares y movimiento de precio de corto plazo calculados con Twelve Data.
- ETF: adaptador `ETF_PROVIDER_URL`; opcionalmente Twelve Data `/etfs/world/composition` si `ETF_COMPOSITION_ENABLED=true`.
- Score transparente 0–100.
- Detalle de eventos, fechas y fuentes.

## Fuentes y limitaciones

Los 13F son trimestrales y no representan posiciones en tiempo real. La SEC publica las tablas de información con valor y número de acciones por posición. citeturn0search0turn3search0

Las divulgaciones de Congreso son reportes públicos con retraso respecto a la operación; la Cámara y el Senado mantienen sus sistemas oficiales de divulgación. Para automatización, V2 admite un proveedor como Quiver. citeturn0search12turn0search13turn4search0

La actividad inusual de V2 significa anomalías de precio/volumen; no es todavía un detector de flujo de opciones.

## Variables del Worker

- `SEC_USER_AGENT`: identifica la aplicación ante SEC y debe incluir un contacto.
- `TWELVE_DATA_API_KEY`: clave existente.
- `QUIVER_API_KEY`: opcional; activa operaciones de Congreso por ticker.
- `CONGRESS_API_URL`: opcional; alternativa a Quiver. Debe devolver un array JSON o `{data:[...]}`.
- `ETF_PROVIDER_URL`: opcional; endpoint que acepte `?symbol=TICKER`.
- `ETF_COMPOSITION_ENABLED=true`: opcional; usa composición ETF de Twelve Data, un endpoint premium de alto consumo.
- `INSTITUTIONAL_MANAGERS`: en esta versión los gestores SEC están definidos en código para evitar depender de un proveedor externo.

## Señal

El score no pretende identificar "dinero inteligente" con certeza. Se usa como agregador de evidencia:

- Insider BUY/SELL: ±20.
- Institucional 13F: +5 cuando existe posición coincidente en la muestra.
- Congreso BUY/SELL: ±5.
- Actividad inusual: hasta ±15.

Un score alto debe interpretarse junto con la fecha de cada evento y la calidad de los datos.
