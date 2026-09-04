# Guía de desarrollo de Morse-vBand-LAN

Esta guía explica el proyecto en el orden en que se ejecuta. Su objetivo es permitir retomar el desarrollo sin tener que reconstruir mentalmente la arquitectura en cada sesión.

## 1. Modelo mental

Morse-vBand-LAN es una aplicación Node.js en memoria con dos interfaces web:

1. El estudiante conecta un manipulador Morse-vBand, que funciona como teclado USB HID.
2. `Ctrl izquierdo` representa DIT y `Ctrl derecho` representa DAH.
3. El navegador del estudiante crea la temporización iámbica y reproduce su sidetone local.
4. Socket.IO envía únicamente estados de tecla y datos de control; nunca transporta audio.
5. El servidor decide quién puede transmitir, mide cada elemento, decodifica Morse y retransmite el evento.
6. Cada receptor genera nuevamente el sonido con WebAudio usando la duración medida por el servidor.
7. El instructor administra canales y políticas desde otra página.

La separación principal es:

```text
hardware HID → navegador estudiante → Socket.IO → servidor → Socket.IO → navegadores receptores
                    │                       │                         │
              sidetone local        control y decodificación   audio reconstruido
```

## 2. Árbol del proyecto

| Ruta | Responsabilidad |
|---|---|
| `server/server.js` | HTTP, Socket.IO, autenticación y protocolo principal. |
| `server/channels.js` | Estado de canales, bloqueo TX, decodificación y registros. |
| `server/clients.js` | Identidad temporal de estudiantes por socket. |
| `public/index.html` | Estructura de la interfaz del estudiante. |
| `public/app.js` | Controlador de la interfaz del estudiante. |
| `public/cw-keyer.js` | Máquina de estados del manipulador. |
| `public/cw-audio.js` | WebAudio local y programación del audio remoto. |
| `public/log-format.js` | Convierte filas de log en una transcripción TXT legible. |
| `public/instructor.html` | Estructura del panel del instructor. |
| `public/instructor.js` | Renderizado y acciones administrativas. |
| `public/*.css` | Tema común, instructor y decodificadores. |
| `test/instructor.test.js` | Prueba integral del protocolo Socket.IO. |
| `Dockerfile` | Construcción de la imagen de producción. |
| `docker-compose.yml` | Puerto, PIN, reinicio y nombre del contenedor. |

## 3. Inicio de la aplicación

`npm start` ejecuta `node server/server.js`.

El servidor realiza estos pasos:

1. Lee `PORT`; usa `8080` si no existe.
2. Lee `INSTRUCTOR_PIN`; usa `morse-admin` como valor de desarrollo.
3. Crea Express y un servidor HTTP.
4. Conecta Socket.IO al mismo servidor.
5. Publica `public/` como archivos estáticos.
6. Expone `GET /health`, que responde `{ "status": "ok" }`.
7. Escucha en `0.0.0.0`, permitiendo conexiones desde la LAN.

Docker copia primero `package*.json`, instala dependencias de producción y luego copia `server/` y `public/`. Este orden permite reutilizar la capa de dependencias cuando solo cambia el código.

## 4. Estado en memoria

No existe base de datos. Al reiniciar Node.js se pierden canales, usuarios, políticas, decodificación y registros.

### 4.1 Estudiantes

`server/clients.js` mantiene un `Map`:

```text
socketId → { id, callsign, channel }
```

`normalize()` convierte indicativos y canales a mayúsculas, elimina caracteres ajenos a `A-Z`, `0-9`, `/`, `_` y `-`, y limita su longitud.

### 4.2 Instructores

`server/server.js` mantiene otro `Map`:

```text
socketId → callsign del instructor
```

Un instructor autenticado entra en la sala interna `__instructors`. Esa sala no aparece en el directorio público y tiene dos funciones:

- enviar `instructor:state` solamente a paneles autenticados;
- entregar `instructor:cw` para que el instructor pueda escuchar las señales de los canales que supervisa.

El audio continúa siendo local. `instructor:cw` transporta metadatos de tecla, no muestras de sonido.

### 4.3 Canales

`server/channels.js` mantiene:

```text
nombre → objeto room
```

Campos importantes de `room`:

| Campo | Uso |
|---|---|
| `members` | IDs de sockets de estudiantes. |
| `transmitter` | Socket que posee el transmisor o `null`. |
| `releaseTimer` | Temporizador para liberar TX después de un elemento. |
| `locked` | Impide nuevos ingresos. |
| `receiveOnly` | Impide toda transmisión estudiantil. |
| `mandatoryWpm` | Velocidad impuesta; actualmente inicia en 15 PPM. |
| `mandatoryMode` | `iambic-a`, `iambic-b`, `straight` o `null`. |
| `toneFrequency` | Frecuencia entre 300 y 1200 Hz. |
| `toneWaveform` | `sine`, `triangle` o `square`. |
| `decodeText`, `decodeCode` | Qué información de decodificación se muestra. |
| `exercise` | Texto de práctica, máximo 500 caracteres. |
| `reservedFor` | Operador con TX reservado. |
| `muted` | Estudiantes impedidos de transmitir. |
| `decoderDisabled` | Estudiantes cuyo panel decodificador está apagado. |
| `activity` | Estado de decodificación por operador. |
| `logs` | Hasta 10.000 filas de actividad. |
| `persistent` | Conserva el canal vacío si fue creado por el instructor. |

`ensure(name)` es el único lugar que define los valores iniciales. Si se agrega una política, debe añadirse allí, incluirse en `roomState()` y aplicarse en el cliente correspondiente.

## 5. Conexión y directorio de canales

Al abrir un socket, el servidor emite `room:list` inmediatamente.

```js
[{ name: 'LOBBY', operators: 2, locked: false }]
```

`publishDirectory()` vuelve a emitir la lista cuando alguien ingresa, sale o una acción cambia el canal.

El estudiante envía:

```js
socket.emit('room:join', { callsign, channel }, callback)
```

El servidor:

1. Normaliza el canal.
2. Rechaza el ingreso si está bloqueado.
3. Retira al socket de su canal anterior.
4. Guarda la identidad en `clients`.
5. Une el socket a la sala Socket.IO y al conjunto `room.members`.
6. Publica estado y directorio.
7. Responde `{ ok, client, state }`.

Un canal creado implícitamente por un estudiante desaparece al quedar vacío. Uno creado mediante la acción `create` es persistente hasta cerrarlo o reiniciar el servidor.

## 6. Flujo del manipulador

`public/app.js` escucha `keydown` y `keyup`. Solo acepta:

```text
ControlLeft  → dit
ControlRight → dah
```

Los eventos repetidos del teclado se ignoran. Al perder foco, `releaseAll()` evita una tecla pegada.

### 6.1 Máquina de estados

`CwKeyer` conserva:

- `paddles`: estado físico actual.
- `memory`: elementos recordados durante otro elemento.
- `running`: evita iniciar dos bucles.
- `last`: permite alternar durante un squeeze.
- `currentElement`: elemento que está sonando.
- `squeezeSeen`: diferencia Iámbico A de B.

La duración fundamental es:

```text
ditMs = 1200 / WPM
DIT   = 1 × ditMs
DAH   = 3 × ditMs
pausa entre elementos = 1 × ditMs
```

En llave vertical, el firmware/navegador transmite directamente mientras cualquiera de las paletas esté presionada.

## 7. Solicitud de transmisión

Por cada cambio, el estudiante emite `cw:key`:

```js
{ down: true }
{ down: false }
```

El WPM enviado por el navegador no es confiable ni necesario. El servidor usa `room.mandatoryWpm`.

Al recibir `down: true`, `channels.acquire()` valida en orden:

1. El canal no está en solo recepción.
2. El estudiante no está silenciado.
3. El transmisor no está reservado para otro usuario.
4. Ningún otro socket posee TX.

Si pasa, asigna `room.transmitter`, cancela una liberación pendiente y actualiza la actividad.

Al recibir `down: false`, el servidor exige que el socket siga siendo propietario. Después programa la liberación en:

```text
4800 / WPM milisegundos
```

Esto equivale a cuatro unidades DIT y evita que otro operador interrumpa entre elementos o letras.

## 8. Audio

### 8.1 Sidetone local

El navegador transmisor llama `localAudio.keyDown()` antes de enviar el evento y `keyUp()` al terminar. Así su sonido no depende de la red.

`CwAudio` crea una sola vez:

```text
OscillatorNode → GainNode → destino
```

El oscilador permanece activo; solo cambia la ganancia. Esto evita crear nodos en cada DIT/DAH y reduce clics.

### 8.2 Audio remoto

El servidor mide el tiempo entre down y up y retransmite:

```js
{ down, callsign, senderId, at, durationMs }
```

`app.js` serializa los eventos con `remoteAudioQueue`. El `.catch(() => {})` es deliberado: un error aislado de WebAudio no debe detener todos los sonidos posteriores.

`scheduleRemoteKey()` usa:

- la hora del servidor;
- la duración medida;
- un búfer de 75 ms;
- rampas de ataque de 12 ms y liberación de 14 ms.

El búfer intercambia una pequeña latencia constante por mejor sincronía en Wi-Fi. Si reaparecen pops, revisar primero superposición de automatizaciones, volumen del `GainNode`, ahorro de energía y suspensión del `AudioContext`.

## 9. Decodificación Morse

Cada operador tiene un objeto en `room.activity` con contador, hora, elemento actual, código acumulado, texto y temporizadores.

Campos relevantes:

| Campo | Significado |
|---|---|
| `keyDowns` | Cantidad de pulsaciones aceptadas. |
| `lastTransmitAt` | Última adquisición válida de TX. |
| `keyStartedAt` | Inicio del elemento que se está midiendo. |
| `currentCode` | Puntos y rayas de la letra todavía abierta. |
| `code`, `text` | Ventanas móviles visibles, limitadas a 500 y 250 caracteres. |
| `codeLength`, `textLength` | Posiciones absolutas y monotónicas del flujo decodificado. |
| `letterTimer`, `wordTimer` | Cierre diferido de letra y palabra. |

Al soltar la tecla, `recordKey()` compara la duración:

```text
duración < 2 × ditMs → punto
duración ≥ 2 × ditMs → raya
```

Un nuevo down cancela los temporizadores de letra y palabra. Si no llega otro elemento:

- después de `2 × ditMs`, se cierra la letra y se consulta `MORSE`;
- después de `6 × ditMs`, se agrega un espacio de palabra y ` / ` al código.

Estos umbrales están entre las separaciones Morse nominales: un elemento (1), una letra (3) y una palabra (7).

El historial visible está limitado a 500 caracteres de código y 250 de texto. Un patrón desconocido produce `?`.

### 9.1 Cursores monotónicos

`codeLength` y `textLength` nunca representan el tamaño actual de las ventanas `code` y `text`. Representan cuántos caracteres han existido desde que se creó la actividad del operador. Por eso continúan creciendo aunque `.slice(-500)` o `.slice(-250)` descarte contenido antiguo.

`roomState()` expone esos valores como `codeCursor` y `textCursor`. Si existe `currentCode`, `codeCursor` incluye también el separador necesario y los símbolos de esa letra provisional. Al cerrarse la letra, el cursor debe conservar exactamente el mismo valor: finalizar una previsualización no puede hacerlo retroceder.

Este detalle es especialmente importante después de ` / `. Tanto la construcción provisional en `roomState()` como la construcción definitiva en `recordKey()` deben aplicar la misma regla para el separador:

```text
agregar un espacio solo si code existe y no termina en " / "
```

Una discrepancia aquí hace retroceder `codeCursor` y provoca que los clientes interpreten el cambio como un reinicio del decodificador.

## 10. Estados publicados

`roomState(channel)` transforma estructuras internas (`Map`, `Set`, temporizadores) en JSON apto para el navegador:

```js
{
  channel,
  instructors: [{ id, callsign, role }],
  operators: [{
    id, callsign, muted, decoderEnabled, reserved,
    keyDowns, lastTransmitAt,
    code, codeCursor, text, textCursor
  }],
  transmitter,
  policy: {
    locked, receiveOnly, mandatoryWpm, mandatoryMode,
    toneFrequency, toneWaveform, decodeText, decodeCode,
    exercise, reservedFor
  }
}
```

`publish(channel)` envía `room:state` al canal y actualiza también a los instructores. `publishAllRooms()` se usa cuando un instructor entra o sale, porque su presencia debe cambiar en todas las listas.

### 10.1 Eventos principales

| Evento | Emisor → receptor | Contenido y finalidad |
|---|---|---|
| `room:list` | servidor → todos | Directorio resumido de canales. |
| `room:join` | estudiante → servidor | Indicativo y canal; responde con cliente y estado inicial. |
| `room:state` | servidor → canal | Estado autoritativo para las interfaces estudiantiles. |
| `cw:key` | estudiante ↔ servidor → receptores | Estado de tecla y, al salir del servidor, hora y duración medida. |
| `instructor:login` | instructor → servidor | PIN e indicativo; responde con todos los canales. |
| `instructor:state` | servidor → `__instructors` | Vista administrativa completa. |
| `instructor:cw` | servidor → `__instructors` | Evento CW con campo `channel` para monitorización de audio. |
| `instructor:action` | instructor → servidor | Acción administrativa autenticada. |
| `logs:get` | navegador → servidor | Filtrado de filas por canal y operador. |

Los eventos de audio para instructores usan un nombre distinto (`instructor:cw`) para no confundirlos con los `cw:key` que pertenecen a la sala de estudiantes. Además incluyen `channel`, ya que el instructor no está unido a cada sala pública.

## 11. Interfaz del estudiante

`applyState()` es la función central. Cada estado recibido:

1. Renderiza operadores e instructores.
2. Actualiza el propietario de TX.
3. Calcula si el usuario puede transmitir.
4. Aplica PPM, frecuencia, forma de onda y modo.
5. Activa o apaga el decodificador individual.
6. Muestra el ejercicio.

No debe mantenerse una segunda copia independiente de políticas en el navegador. El servidor es la fuente de verdad.

### 11.1 Paneles y limpieza visual

`renderDecoders()` crea un panel multilínea por operador. `.decode-message` define altura mínima, ajuste de línea y desplazamiento vertical para que un mensaje largo no deforme el resto de la página.

El botón **Limpiar vista** es deliberadamente local al navegador. No envía un evento al servidor, no cambia `room.activity` y no toca `room.logs`. Tampoco limpia la vista de otros estudiantes ni la del instructor.

`decoderViews` mantiene, por ID de operador:

```js
{ textCursor, codeCursor, text, code }
```

En cada estado nuevo se calcula la diferencia entre el cursor recibido y el cursor anterior. Solo esa cantidad de caracteres, tomada desde el final de la ventana del servidor, se agrega a la vista local. Al limpiar, `text` y `code` pasan a cadenas vacías, pero los cursores se conservan. Así el siguiente evento agrega exclusivamente material nuevo.

No se debe volver a inferir contenido nuevo buscando prefijos o sufijos coincidentes. Los patrones Morse repetidos hacen ambiguo ese método, especialmente cuando la ventana móvil descarta caracteres antiguos.

## 12. Instructor

El login usa `crypto.timingSafeEqual()` y solo compara buffers de igual longitud. Tras autenticarse, el socket entra en `__instructors` y aparece por indicativo ante los estudiantes.

El panel recibe el estado completo en `instructor:state`. Todos los botones llaman:

```js
instructor:action { channel, action, value, target }
```

Acciones actuales:

| Acción | Efecto |
|---|---|
| `create`, `close` | Crea o elimina un canal. |
| `lock` | Bloquea nuevos ingresos. |
| `receiveOnly` | Impide TX y corta el TX actual. |
| `exercise` | Asigna texto. |
| `wpm`, `tone`, `waveform`, `mode` | Cambia políticas de CW/audio. |
| `decodeText`, `decodeCode` | Controla los tipos de salida decodificada. |
| `studentDecoder` | Activa el panel de un estudiante concreto. |
| `reserve` | Reserva TX para un socket. |
| `mute` | Impide transmitir a un estudiante. |
| `disconnect` | Cierra el socket objetivo. |
| `clear` | Libera TX y elimina la reserva. |

Toda acción administrativa debe verificarse en el servidor, aunque el botón solo exista en la página del instructor.

### 12.1 Monitor de audio del instructor

`public/instructor.js` crea un `CwAudio` dedicado llamado `monitorAudio`. El formulario de acceso llama `monitorAudio.unlock()` directamente desde el gesto de pulsar **Ingresar**. Hacerlo dentro de una respuesta Socket.IO posterior puede fallar debido a las políticas de reproducción automática del navegador.

Después de autenticar:

1. el servidor publica cada evento aceptado mediante `instructor:cw`;
2. el cliente localiza el canal en `latestInstructorState`;
3. aplica `toneFrequency` y `toneWaveform` de ese canal;
4. encadena `scheduleRemoteKey()` mediante `monitorAudioQueue`.

Los eventos rechazados por solo recepción, mute, reserva o TX ocupado no se publican y por tanto no deben producir audio. Los key-up generados al forzar una liberación o desconectar al transmisor también se envían al instructor para evitar tonos sostenidos.

Actualmente el panel monitoriza todos los canales activos con un solo oscilador. Dos transmisiones simultáneas en canales diferentes pueden competir por la frecuencia y la programación de ganancia; si se requiere supervisión simultánea real, la evolución natural es mantener una instancia `CwAudio` y una cola por canal, además de controles para seleccionar o silenciar canales.

## 13. Registros

Al completar una letra, el servidor guarda una fila con timestamp, socket, indicativo, Morse, texto, WPM, modo, frecuencia, forma de onda y duración.

Solo se conservan las 10.000 filas más recientes por canal. `logs:get` permite:

- sin `target`: registro completo del canal;
- con `target`: registro de ese operador.

Un estudiante solo puede pedir registros de su canal actual. El instructor autenticado puede pedirlos por canal. TXT y CSV se generan en el navegador con `Blob`; no se escriben archivos en el servidor.

La dirección TX/RX se calcula desde la perspectiva del socket que descarga: sus propias filas son TX y las demás RX.

### 13.1 CSV detallado

El CSV conserva una fila por letra y las columnas originales:

```text
timestamp, channel, direction, callsign, morse, text,
wpm, mode, toneFrequency, toneWaveform, keyDurationMs
```

Se usa `quote()` para encerrar todos los valores entre comillas y duplicar comillas internas. Este formato es el adecuado para análisis temporal y hojas de cálculo; no debe simplificarse al mejorar el TXT.

### 13.2 TXT legible

`public/log-format.js` agrupa filas consecutivas compatibles en bloques de transmisión. Un bloque conserva operador, dirección y configuración, pero concatena las letras en una sola línea `Texto:` y los símbolos en una línea `Morse:`.

Como el log se registra al cerrar cada letra y no guarda una fila separada para el espacio, `startsNewWord()` estima el comienzo de la letra actual:

```text
inicio estimado = timestamp - (unidades Morse de la letra + 2) × ditMs
```

Las rayas cuentan tres unidades, los puntos una y las pausas internas una. Si el intervalo estimado respecto de la letra anterior alcanza tres unidades DIT, el formateador agrega un espacio al texto y `/` al Morse. Esta heurística convierte el TXT en una transcripción humana sin alterar el CSV ni el modelo de logs del servidor.

Cambios de operador, dirección, PPM, modo, frecuencia o forma de onda abren un bloque nuevo. Un registro vacío genera un TXT válido con `No hay mensajes registrados.`.

Al final, el TXT agrega `Interacción TX/RX`: una transcripción compacta que conserva solo dirección, indicativo y texto. Los bloques detallados anteriores permanecen sin cambios. Si no existen entradas, esta sección indica `No hay interacción registrada.`.

## 14. Desconexión y limpieza

Al desconectar:

1. Se elimina la presencia de instructor, si corresponde.
2. Se elimina el cliente.
3. `channels.leave()` limpia mute, decodificador, actividad y reserva.
4. Si poseía TX, se libera y se envía key-up a los receptores.
5. Si el canal queda vacío y no es persistente, se elimina.
6. Se publican estado y directorio nuevos.

Siempre que se agregue un temporizador o estado por usuario, también debe limpiarse en `leave()` y `close()`.

## 15. Pruebas

`npm test` levanta un servidor real en el puerto 18081 y conecta un instructor y dos estudiantes con `socket.io-client`.

La prueba cubre autenticación, creación duplicada, presencia, decodificador individual, solo recepción, reserva, mute, límites de tono, waveform, modo, duración remota, audio enviado al instructor, decodificación, cursores monotónicos después de un separador de palabra y registros.

Antes de entregar cambios:

```sh
node --check server/server.js
node --check server/channels.js
node --check public/app.js
node --check public/instructor.js
node --check public/log-format.js
npm test
git diff --check
```

## 16. Recetas para extender sin perderse

### Agregar una política de canal

1. Definir el valor inicial en `channels.ensure()`.
2. Incluirlo en `roomState().policy`.
3. Añadir una acción autenticada en `instructor:action`.
4. Crear el control en `instructor.js`.
5. Aplicarlo en `app.js`.
6. Añadir una aserción integral.

### Agregar estado por estudiante

1. Guardarlo por `socketId` en el canal.
2. Exponerlo dentro del operador en `roomState()`.
3. Validar `target` contra `room.members`.
4. Limpiarlo en `leave()`.
5. Probar que cambiar A no cambia B.

### Agregar un evento Socket.IO

Documentar payload, respuesta, autorización, destinatario y momento de publicación. Usar callbacks `{ ok, reason }` para que la UI pueda mostrar fallos.

### Cambiar audio

Probar por separado sidetone local y recepción remota. No asumir que el audio remoto puede usar tiempos de llegada de red. Mantener recuperable la cola de promesas y probar en teléfono con pantalla activa.

Para el instructor, verificar además que `instructor:cw` incluya el canal, que `unlock()` siga ligado al gesto de login y que toda ruta que fuerce la liberación de TX publique un key-up.

### Cambiar el decodificador visible

1. Mantener `codeCursor` y `textCursor` monotónicos.
2. Conservar idéntica la representación provisional y definitiva de separadores.
3. No modificar logs desde **Limpiar vista**.
4. Probar al menos: letra nueva, palabra nueva, Morse repetido, limpieza seguida de RX y truncamiento de la ventana móvil.

### Cambiar formatos de descarga

Mantener el CSV como fuente detallada por evento. Las mejoras de legibilidad deben implementarse en `log-format.js` para el TXT. Verificar descargas vacías, un solo operador, alternancia de operadores, pausas de palabra y cambios de configuración.

## 17. Riesgos y límites actuales

- Todo el estado es volátil.
- El PIN protege controles administrativos, no convierte la LAN en un entorno hostil seguro.
- No existe rate limiting.
- Los logs internos y el CSV son por letra; el TXT reconstruye mensajes mediante una heurística temporal.
- La tabla Morse cubre A-Z y 0-9, no puntuación.
- La prueba integral usa un puerto fijo.
- Un instructor aparece en todos los canales porque administra todos desde un solo panel.
- El monitor del instructor usa un solo oscilador para todos los canales; no mezcla canales simultáneos de forma independiente.
- Los navegadores móviles pueden suspender WebAudio al apagar la pantalla.

## 18. Sesión de desarrollo recomendada

```sh
cd /home/rasputin/Projects/Morse-vBand-LAN
git status --short --branch
git pull --ff-only
npm ci
npm test
```

Después del cambio, ejecutar las validaciones, revisar `git diff`, reconstruir Docker y hacer actualización forzada del navegador:

```sh
sudo docker compose up -d --build --force-recreate
sudo docker compose logs --tail=100
```

No trabajar desde dos clones distintos sin comprobar `pwd` y `git rev-parse --short HEAD`; una compilación desde un clon antiguo puede parecer un fallo de caché aunque Docker esté funcionando correctamente.
