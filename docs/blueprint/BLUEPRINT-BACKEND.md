# BLUEPRINT BACKEND v2 — NestJS 12 + TypeORM 1.1 + PostgreSQL 17 sobre AWS Lambda (Node 24), infraestructura con AWS CDK

**Plantilla de arranque completa para construir una aplicación empresarial nueva. Parte de un backend que ya funciona en producción y lo endurece en seguridad, rendimiento, observabilidad, operación y cumplimiento.**

> **Versión 2.0 — 2026-10-07.** Esta versión reemplaza a la v1 (la transcripción del backend original). La v1 queda en el historial de git como referencia, pero **no debe usarse para implementar**. Cuando la v1 y la v2 no coinciden, manda la v2. La sección 0.6 resume qué cambió y la sección 27 explica cada decisión.
>
> **Todo el código núcleo de esta versión fue compilado y probado** antes de escribirse aquí: un proyecto de verificación con estos mismos archivos pasó lint con reglas tipadas, typecheck estricto, 10 tests unitarios y 44 tests e2e contra PostgreSQL 17 real, el empaquetado de las Lambdas con una invocación simulada de API Gateway, `cdk synth` de los tres stages con cdk-nag como gate, y `actionlint` sobre los workflows. Lo que **no** se pudo probar sin una cuenta AWS (el primer despliegue real) está marcado como tal y tiene su comando de verificación en el plan (sección 20).

---

## 0. Propósito y cómo usar este documento

### 0.1 Qué es esto

Este documento describe, archivo por archivo, el núcleo reutilizable de un backend NestJS sobre AWS Lambda: Cognito como proveedor de identidad, PostgreSQL en RDS (detrás de RDS Proxy) como persistencia, AWS CDK como infraestructura como código y GitHub Actions con OIDC como pipeline.

Nació como transcripción de un backend real en producción (dominio: evaluación de riesgo crediticio). **El dominio no se reutiliza.** Se reutiliza todo lo que hay debajo: arranque, configuración, autenticación, RBAC, auditoría, documentos en S3, migraciones, infraestructura, CI/CD, observabilidad y operación.

La v2 añade sobre el original lo que le faltaba para ser una aplicación empresarial y rápida: sesión en cookies `httpOnly` servida desde el mismo dominio que el frontend, MFA, WAF, infraestructura completa como código, base de datos privada con autenticación IAM, despliegues con versión y rollback, logs estructurados con trazabilidad por petición, alarmas, backups y recuperación ante desastres, y presupuestos de rendimiento.

### 0.2 Quién lee esto

Un **agente de código autónomo** que trabaja en un repositorio vacío y que **no tiene acceso al repositorio original**. Por eso:

- Todo archivo del núcleo está **completo**, listo para copiar y pegar.
- No hay referencias del tipo "ver el archivo X del repo original": si se necesita, está aquí.
- Los nombres propios fueron sustituidos por **marcadores** (sección 1). Hay que reemplazarlos de forma consistente antes de escribir el primer archivo.
- Donde el documento no puede garantizar un detalle (por ejemplo, el comportamiento de una versión concreta de una librería), lo dice y da el comando para verificarlo. **No asumir: verificar.**

### 0.3 Sistema de etiquetas

Cada bloque de este documento lleva una etiqueta. **Respetarlas es obligatorio.**

| Etiqueta | Significado | Qué hacer |
|---|---|---|
| 🟩 **NÚCLEO** | Infraestructura reutilizable, independiente del dominio | **Copiar literalmente**, sustituyendo marcadores |
| 🆕 **V2** | Núcleo nuevo o reescrito en la v2 (no existía así en el original) | **Copiar literalmente**, igual que el núcleo. La etiqueta solo indica procedencia |
| 🟦 **EJEMPLO DE DOMINIO** | Código del dominio original, incluido solo como referencia de patrón | **No copiar**. Leer, entender la forma, aplicarla al dominio nuevo |
| 🟥 **DEUDA — NO REPLICAR** | El original lo hace así y está mal | **No copiar**. La sección 19 explica la corrección obligatoria |

### 0.4 Orden de lectura y ejecución

1. Leer las secciones **0 a 3** completas antes de escribir nada. Definen decisiones, marcadores, topología y prerrequisitos.
2. Leer la sección **27 (registro de decisiones)**. Explica el porqué de cada elección de la v2; sin ese contexto es fácil "simplificar" algo que es así a propósito.
3. Leer las secciones **23 a 26** (seguridad, observabilidad, rendimiento, datos y recuperación). Son transversales: afectan a casi todos los archivos.
4. Ejecutar el **plan de la sección 20** de arriba abajo. Cada fase termina con un comando de verificación que debe pasar antes de seguir.
5. Cerrar con el **checklist de la sección 21**.

### 0.5 Reglas que no se negocian

- **Nunca** se commitea un `.env`. Está en `.gitignore` desde el primer commit.
- **Nunca** se pasa un secreto como variable de entorno de Lambda. Los secretos viven en AWS Secrets Manager y se leen al arrancar (sección 7.4). La base de datos no usa contraseña desde la Lambda: usa autenticación IAM contra RDS Proxy (sección 7.2).
- **Nunca** se corren migraciones en el arranque de la API. Las corre una Lambda dedicada (`migrator`) que el CI invoca **antes** de publicar el código nuevo (secciones 11.3 y 17).
- **Ninguna** entidad usa `synchronize: true`. Todo cambio de esquema es una migración versionada y **compatible hacia atrás** (sección 11.3).
- **Ningún** token de sesión es legible por JavaScript. El backend emite cookies `httpOnly`, `Secure`, `SameSite=Strict` (sección 10).
- **Ningún** recurso de AWS se crea a mano, salvo los tres de arranque de la sección 3.2. Todo lo demás es código CDK revisado por PR (sección 16).
- La base de datos **no es accesible desde internet**. Vive en subredes privadas; solo las Lambdas de la VPC llegan a ella.
- Dinero y cantidades exactas: columna `numeric` en PostgreSQL, `string` en TypeScript, `decimal.js` para operar. **Nunca** `float`/`number` nativo.
- Toda petición lleva un `requestId` que aparece en la respuesta, en los logs, en la auditoría y en los errores (sección 24).

### 0.6 Qué cambió respecto a la v1 (resumen)

| Área | v1 (original) | v2 (este documento) | Detalle |
|---|---|---|---|
| Runtime | Node 20 (deprecado en Lambda el 30/04/2026) | **Node 24** en local, CI y Lambda, arquitectura **arm64** | 3.1, 27 |
| Framework y librerías | NestJS 11, TypeORM 0.3.20, TS 5, Zod 3 | **NestJS 12**, **TypeORM 1.1**, **TypeScript 6.0**, **Zod 4**, **Vitest 5** | 3.1, 4 |
| Gestor de paquetes | npm | **pnpm 12** con `packageManager` fijado, aprobación explícita de scripts de instalación y antigüedad mínima de versiones | 4 |
| Empaquetado | Serverless Framework v3 (sin mantenimiento desde 2025) | **`tsc` + esbuild** (bundle minificado por función) | 6.11 |
| Infraestructura | Recursos creados a mano + `serverless.yml` | **AWS CDK** para todo: red, base de datos, Cognito, S3, CloudFront, WAF, alarmas, OIDC. **cdk-nag** (AWS Solutions) como gate de seguridad | 16 |
| Dominio y CORS | Front y API en orígenes distintos, CORS `*` en Lambda | **Mismo dominio**: CloudFront sirve el front y enruta `/api/*` a la API. Sin CORS ni preflight | 2, 8 |
| Sesión | Tokens en cookies legibles por JS, Bearer en cada llamada | **Cookies `httpOnly`** emitidas por el backend, rotación de refresh token, protección CSRF | 10 |
| MFA | No | **TOTP obligatorio** (configurable) con flujo de retos genérico | 10 |
| Validación JWT | Solo firma y expiración | Firma + `iss` + `client_id` + `token_use=access`; falla cerrado ante error de BD | 10.4 |
| Rate limiting | Throttler en memoria (inútil en Lambda) | **AWS WAF** (reglas gestionadas y por tasa) + throttling de API Gateway | 23 |
| Base de datos | Pública, contraseña, sin pool limitado | **Privada**, RDS Proxy con **IAM de extremo a extremo** (ningún rol de aplicación tiene contraseña), Multi-AZ en prod, PITR, cifrado | 7.2, 16.4, 26 |
| Migraciones | Desde el runner de CI hacia una BD pública | **Lambda `migrator`** dentro de la VPC, invocada por el CI | 11.3, 17 |
| Documentos | Evento S3 directo al worker, sin reintentos | **Antivirus GuardDuty** → EventBridge → **SQS + DLQ** → worker | 13 |
| Despliegue | `update-function-code` sin versiones | **Versiones + alias** de Lambda, **canary** con rollback automático en prod, aprobación manual | 17 |
| Entornos | Una cuenta AWS, rama → stage | Cuenta **no-prod** (dev, qa) y cuenta **prod**; una rama `main`, promoción dev → qa → prod del **mismo artefacto** | 16, 17 |
| Observabilidad | Logs de texto libre, una alarma | Logs **JSON** (pino) con `requestId`, **X-Ray**, **Sentry**, dashboard, alarmas con SNS | 24 |
| Tests | Jest añadido por el blueprint | **Vitest** + Supertest + PostgreSQL real en CI, Cognito simulado con tokens RS256 locales, umbral de cobertura | 15 |
| Auditoría | Inconsistente, mutable | **Append-only** a nivel de BD, con antes/después y `requestId` | 11.2 |

---

## Índice

- [0. Propósito y cómo usar este documento](#0-propósito-y-cómo-usar-este-documento)
- [1. Tabla de marcadores y convención de nombres](#1-tabla-de-marcadores-y-convención-de-nombres)
- [2. Resumen de arquitectura](#2-resumen-de-arquitectura)
- [3. Prerrequisitos](#3-prerrequisitos)
- [4. `package.json` completo](#4-packagejson-completo)
- [5. Estructura de carpetas](#5-estructura-de-carpetas)
- [6. Archivos de configuración del proyecto](#6-archivos-de-configuración-del-proyecto)
- [7. Capa de configuración (`src/config/`)](#7-capa-de-configuración-srcconfig)
- [8. Bootstrap: `configure-app.ts`, `main.ts`, `lambda.ts`, `app.module.ts`](#8-bootstrap-configure-appts-maints-lambdats-appmodulets)
- [9. Cross-cutting (`src/common/`)](#9-cross-cutting-srccommon)
- [10. Autenticación y RBAC con Cognito, end to end](#10-autenticación-y-rbac-con-cognito-end-to-end)
- [11. Capa de datos: entidades, convenciones y migraciones](#11-capa-de-datos-entidades-convenciones-y-migraciones)
- [12. Anatomía de un módulo de feature](#12-anatomía-de-un-módulo-de-feature)
- [13. Documentos y S3](#13-documentos-y-s3)
- [14. Jobs programados (cron Lambda)](#14-jobs-programados-cron-lambda)
- [15. Testing](#15-testing)
- [16. Infraestructura como código (AWS CDK)](#16-infraestructura-como-código-aws-cdk)
- [17. CI/CD](#17-cicd)
- [18. Entorno de desarrollo local y Cursor Cloud](#18-entorno-de-desarrollo-local-y-cursor-cloud)
- [19. Correcciones obligatorias respecto al original](#19-correcciones-obligatorias-respecto-al-original)
- [20. Plan de implementación ordenado](#20-plan-de-implementación-ordenado)
- [21. Checklist de aceptación final](#21-checklist-de-aceptación-final)
- [22. Errores conocidos y cómo evitarlos](#22-errores-conocidos-y-cómo-evitarlos)
- [23. Seguridad empresarial](#23-seguridad-empresarial)
- [24. Observabilidad](#24-observabilidad)
- [25. Rendimiento](#25-rendimiento)
- [26. Datos, backups, recuperación y cumplimiento](#26-datos-backups-recuperación-y-cumplimiento)
- [27. Registro de decisiones (ADR)](#27-registro-de-decisiones-adr)
- [Anexo A — Puntos abiertos y cómo resolverlos](#anexo-a--puntos-abiertos-y-cómo-resolverlos)

---

## 1. Tabla de marcadores y convención de nombres

### 1.1 Marcadores

🆕 **V2** — Todo el código usa estos marcadores. **Antes de escribir el primer archivo, fijar el valor de cada uno y aplicarlo de forma consistente en los dos repositorios.** La columna "valor propuesto" trae los valores ya decididos para este proyecto; los que dicen *pendiente* los confirma el responsable del producto (Anexo A).

| Marcador | Qué es | Forma esperada | Valor propuesto |
|---|---|---|---|
| `<org>` | Prefijo de organización. Primer segmento de las rutas de Secrets Manager y SSM | `[a-z0-9-]+` | `anka` |
| `<app-short>` | Nombre corto del producto. Prefijo de stacks, funciones, buckets y cookies | `[a-z0-9-]{3,12}` | `propia` |
| `<app_snake>` | El mismo nombre en `snake_case`, para la base de datos | `[a-z0-9_]+` | `propia` |
| `<app>` | Nombre del repositorio del backend y del paquete npm | `[a-z0-9-]+` | `propia-backend` |
| `<app-frontend>` | Nombre del repositorio del frontend | `[a-z0-9-]+` | `propia-frontend` |
| `<GITHUB_ORG>` | Organización de GitHub dueña de los dos repositorios | texto | `ANKASAFI` |
| `<stage>` | Entorno de despliegue | `dev` \| `qa` \| `prod` | — |
| `<ACCOUNT_NONPROD>` | Cuenta AWS que aloja `dev` y `qa` | 12 dígitos | *pendiente* |
| `<ACCOUNT_PROD>` | Cuenta AWS que aloja `prod` | 12 dígitos | *pendiente* |
| `<REGION>` | Región AWS principal de todo el stack | `us-east-1`, `sa-east-1`, … | `us-east-1` |
| `<DOMINIO_BASE>` | Dominio registrado en Route 53 | dominio | *pendiente* |
| `<HOSTED_ZONE_ID>` | Id de la zona alojada de `<DOMINIO_BASE>` en Route 53 | `Z...` | *pendiente* |
| `<DOMINIO_APP>` | Dominio público del stage (front **y** API, mismo origen) | `app-<stage>.<DOMINIO_BASE>`; en prod `app.<DOMINIO_BASE>` | derivado |
| `<ROL_A>` | Grupo de Cognito con acceso operativo al dominio | nombre de grupo | *pendiente* (depende del dominio) |
| `<ROL_B>` | Grupo de Cognito administrador | nombre de grupo | `Admin` |
| `<ALERT_EMAIL>` | Buzón que recibe alarmas y avisos de presupuesto | email | *pendiente* |
| `<SENTRY_DSN_BACKEND>` | DSN del proyecto de Sentry del backend (no es secreto) | URL | *pendiente* |
| `<ENTITY_ID>` | Identificador natural de la entidad de negocio principal | definido por el dominio | *pendiente* |
| `<DOC_TIPO_1>`, `<DOC_TIPO_2>`, `<DOC_TIPO_3>` | Tipos de documento que el sistema ingiere | slug minúsculas | *pendiente* |
| `<TERMS_URL>` | URL pública de términos y condiciones | URL | *pendiente* |
| `<AUTOR>` | Autor del `package.json` | nombre | `<org>` |

**Marcadores de la v1 que desaparecen.** `<USER_POOL_ID>`, `<CLIENT_ID>`, `<BUCKET_DOCS>`, `<BUCKET_FRONTEND>`, `<BUCKET_DEPLOY>`, `<CF_DIST_ID>`, `<DB_HOST>`, `<DB_NAME>` y `<DEPLOY_ROLE>` ya no se rellenan a mano: los crea CDK y los expone como variables de entorno de las Lambdas o como parámetros SSM de salida (16.9). Si aparecen en un archivo nuevo, es un error.

### 1.2 Convención de nombres derivada

🆕 **V2** — Una vez fijados `<org>`, `<app-short>`, `<REGION>` y las cuentas, **todo lo demás se deriva**. No inventar nombres fuera de este esquema; CDK los construye con la función `name()` de 16.3.

| Recurso | Patrón |
|---|---|
| Stack CDK | `<app-short>-<stage>-<capa>` con `<capa>` ∈ `network`, `data`, `auth`, `storage`, `api`, `migrator`, `edge`, `web`, `observability` |
| Stack CDK de CI (uno por cuenta) | `<app-short>-ci` |
| Función Lambda HTTP | `<app-short>-<stage>-api` |
| Función Lambda worker | `<app-short>-<stage>-ingest-worker` |
| Función Lambda de migraciones | `<app-short>-<stage>-migrator` |
| Función Lambda cron | `<app-short>-<stage>-job-<nombre>` |
| Alias de Lambda que recibe tráfico | `live` |
| HTTP API (API Gateway v2) | `<app-short>-<stage>-http` |
| Cola de ingesta / cola de errores | `<app-short>-<stage>-ingest` / `<app-short>-<stage>-ingest-dlq` |
| Bucket de documentos | `<app-short>-<stage>-docs-<cuenta>` |
| Bucket del sitio estático | `<app-short>-<stage>-web-<cuenta>` |
| Bucket de logs de acceso | `<app-short>-<stage>-logs-<cuenta>` |
| User Pool de Cognito | `<app-short>-<stage>-users` |
| Base de datos | `<app_snake>` (una instancia RDS por stage, una base por instancia) |
| Usuario de BD de la aplicación | `app_user` (solo DML) |
| Usuario de BD de migraciones | `postgres` (usuario maestro; solo lo usa la Lambda `migrator`) |
| Secretos (Secrets Manager) | `/<org>/<app-short>/<stage>/<nombre>` |
| Parámetros SSM de salida | `/<org>/<app-short>/<stage>/<clave>` (un solo prefijo para backend y frontend) |
| Cookies de sesión | `__Host-<app-short>_at`, `__Secure-<app-short>_rt`, `__Secure-<app-short>_mfa` |
| Rama git → stage | Solo `main`. Cada merge despliega a `dev`; `qa` y `prod` se promueven con aprobación (17.2) |
| GitHub Environments | `dev`, `qa`, `prod` |
| Etiquetas obligatorias de todo recurso | `app=<app-short>`, `stage=<stage>`, `owner=<org>`, `managed-by=cdk` |

> **Por qué el número de cuenta va en el nombre de los buckets.** Los nombres de bucket son globales en todo AWS. `<app-short>-dev-docs` puede estar tomado por otra cuenta del mundo; con el sufijo de cuenta la colisión es imposible y el nombre sigue siendo predecible.

> **Por qué un solo prefijo SSM.** La v1 tenía un prefijo para el backend y otro para el frontend, y cada política IAM necesitaba dos ARNs. Ahora CDK escribe todas las salidas bajo `/<org>/<app-short>/<stage>/`, y el pipeline del frontend lee solo las claves `web/*` (16.9).

---

## 2. Resumen de arquitectura

### 2.1 Topología de runtime

🆕 **V2**

```
                      ┌────────────────────────────────────────────────┐
                      │ Navegador (SPA)   https://<DOMINIO_APP>        │
                      └───────────────────────┬────────────────────────┘
                                              │ HTTPS (HTTP/2 y HTTP/3)
                                              ▼
            ┌──────────────────────────────────────────────────────────────────┐
            │ AWS WAF (us-east-1): reglas gestionadas + límites por IP          │
            ├──────────────────────────────────────────────────────────────────┤
            │ CloudFront  (un solo dominio, certificado ACM, cabeceras de        │
            │             seguridad, compresión Brotli/Gzip)                     │
            │   /*       → S3 web (privado, OAC)       caché larga para /_nuxt/* │
            │   /api/*   → API Gateway HTTP API        sin caché, reenvía cookies│
            │              + cabecera secreta x-origin-verify                    │
            └───────────────┬───────────────────────────────┬──────────────────┘
                            │                               │
                            ▼                               ▼
              ┌──────────────────────────┐   ┌───────────────────────────────────┐
              │ S3 <app-short>-<stage>-  │   │ API Gateway HTTP API              │
              │ web-<cuenta>             │   │ <app-short>-<stage>-http          │
              │ (index.html sin caché)   │   │ throttling por stage, ruta '*'    │
              └──────────────────────────┘   └────────────────┬──────────────────┘
                                                              │ alias `live`
   ┌──────────────────────────────── VPC (subredes privadas) ──┼──────────────────────┐
   │                                                          ▼                      │
   │   ┌────────────────────────────┐        ┌──────────────────────────────────┐   │
   │   │ Lambda <app-short>-<stage>-│        │ Lambda <app-short>-<stage>-api   │   │
   │   │ migrator (invocada por CI) │        │ Node 24 · arm64 · 1536 MB · 29 s │   │
   │   └─────────────┬──────────────┘        │ bundle esbuild · X-Ray activo     │   │
   │                 │ usuario maestro       └───┬───────────┬───────────┬──────┘   │
   │                 │ (contraseña rotada en     │ IAM (TLS) │           │          │
   │                 │  Secrets Manager, TLS)    ▼           │           │          │
   │                 │              ┌──────────────────┐     │           │          │
   │                 │              │ RDS Proxy        │     │           │          │
   │                 │              │ IAM de extremo a │     │           │          │
   │                 │              │ extremo          │     │           │          │
   │                 ▼              └────────┬─────────┘     │           │          │
   │        ┌─────────────────────────────────────────┐      │           │          │
   │        │ RDS PostgreSQL 17 (subredes aisladas)    │      │           │          │
   │        │ Multi-AZ en prod · cifrado · PITR 7-35 d │      │           │          │
   │        └─────────────────────────────────────────┘      │           │          │
   │                                                         │ NAT       │ endpoint │
   └─────────────────────────────────────────────────────────┼───────────┼──────────┘
                                                             ▼           ▼
                                      ┌────────────────────────┐  ┌─────────────────┐
                                      │ Cognito User Pool       │  │ S3 docs (gateway│
                                      │ (Essentials, MFA TOTP,  │  │ endpoint),      │
                                      │ rotación refresh token) │  │ Secrets Manager │
                                      └────────────────────────┘  └─────────────────┘

   Subida de documentos (asíncrona):
   Navegador ──PUT presignado──► S3 docs  incoming/…
                                   │ GuardDuty Malware Protection (antivirus)
                                   ▼
                        EventBridge (resultado del escaneo)
                                   │
                                   ▼
                     SQS <app-short>-<stage>-ingest ──(3 fallos)──► DLQ ──► alarma
                                   │
                                   ▼
                     Lambda <app-short>-<stage>-ingest-worker (VPC)
                        limpio → mueve a raw/ y procesa · amenaza → quarantine/

   Programados:  EventBridge Scheduler ──► Lambda <app-short>-<stage>-job-<nombre>
   Observabilidad: CloudWatch Logs (JSON) · métricas · X-Ray · Sentry · alarmas → SNS → <ALERT_EMAIL>
```

**Las cinco decisiones que definen esta topología** (detalle en la sección 27):

1. **Un solo dominio para front y API.** CloudFront enruta `/api/*` a API Gateway. El navegador no hace peticiones *cross-origin*: no hay CORS, no hay preflight `OPTIONS` (una ida y vuelta menos por cada llamada que no sea simple) y las cookies de sesión son de primera parte con `SameSite=Strict`.
2. **Sesión en cookies `httpOnly`.** El JavaScript del navegador nunca ve un token. Un XSS no puede robar la sesión.
3. **Base de datos privada con IAM de extremo a extremo vía RDS Proxy.** Ni la API ni el proxy usan contraseña de base de datos: la Lambda presenta un token IAM de 15 minutos y el proxy entra a PostgreSQL también con IAM. RDS Proxy absorbe la concurrencia de Lambda. Solo la Lambda `migrator` usa el usuario maestro, cuya contraseña rota Secrets Manager.
4. **Todo es CDK.** Un stage nuevo se crea con un comando y queda idéntico a los demás.
5. **Un artefacto, tres entornos.** El código se compila una vez y el mismo bundle se promueve de dev a qa a prod.

### 2.2 Flujo de un request protegido

🆕 **V2**

```mermaid
sequenceDiagram
    autonumber
    participant C as Navegador (SPA)
    participant CF as CloudFront + WAF
    participant AG as API Gateway HTTP API
    participant L as Lambda api (alias live)
    participant N as Nest (serverless-express)
    participant JW as JwtStrategy (JWKS)
    participant DB as PostgreSQL (vía RDS Proxy)
    participant SM as Secrets Manager

    C->>CF: GET /api/recursos/123  (Cookie: __Host-<app-short>_at=…)
    CF->>CF: WAF: reglas gestionadas + límite por IP
    CF->>AG: misma petición + x-origin-verify + CloudFront-Viewer-Address
    AG->>L: evento httpApi v2
    alt arranque en frío
        L->>SM: GetSecretValue (cognito client secret, origin verify)
        L->>N: bootstrapLambda() → NestFactory.create + app.init()
        N-->>L: handler cacheado en memoria
    end
    L->>N: handler(event, context)
    N->>N: requestId → pino-http → helmet → OriginVerifyGuard → CsrfGuard
    N->>JW: JwtAuthGuard: cookie → verificar RS256 contra JWKS, iss, client_id, token_use
    JW->>DB: SELECT "userStatus" FROM users WHERE id = sub (PK, ~1 ms)
    alt userStatus ≠ active, usuario inexistente o BD caída
        JW-->>C: 401 (falla cerrado)
    end
    N->>N: RolesGuard: cognito:groups ∩ @Roles(...)
    N->>N: ValidationPipe (whitelist + transform) sobre el DTO
    N->>DB: consulta del servicio
    DB-->>N: filas
    N-->>C: 200 JSON + x-request-id (log JSON con requestId, sub, ruta, status, ms)
```

### 2.3 Dos caminos de arranque, una sola configuración

🆕 **V2** — El mismo `AppModule` arranca de dos maneras, pero **la configuración HTTP vive en una única función, `configureApp()`** (8.1), que llaman ambos caminos. En la v1 cada camino configuraba CORS, pipes y filtros por su cuenta y divergían (lista blanca en local, `*` en producción). Eso ya no puede pasar.

| | Local | Lambda |
|---|---|---|
| Entrada | `src/main.ts` | `src/lambda.ts` → `src/lambda-bootstrap.ts` |
| Configuración HTTP | `configureApp(app)` | `configureApp(app)` |
| Servidor | `app.listen(PORT, '127.0.0.1')` (Express 5) | `app.init()` + `@codegenie/serverless-express` v5 |
| Prefijo de rutas | `/api` | `/api` (CloudFront reenvía la ruta tal cual) |
| Swagger | sí, en `/docs` | no se monta |
| Cómo llega el navegador | El dev server del front (`127.0.0.1:4200`) hace *proxy* de `/api` a `localhost:3000`: mismo origen también en local | CloudFront `/api/*` |
| Secretos | `.env` | Secrets Manager al arrancar (7.4) |
| Base de datos | Contraseña de `.env` contra PostgreSQL local | Token IAM contra RDS Proxy (7.2) |
| Cookies | Sin prefijo `__Host-`/`__Secure-` y sin `Secure` (HTTP local) | Con prefijo, `Secure`, `SameSite=Strict` |
| Migraciones | `pnpm migration:run` a mano | Lambda `migrator`, invocada por el CI |

---

## 3. Prerrequisitos

### 3.1 Versiones exactas

🆕 **V2**

| Componente | Versión | Nota |
|---|---|---|
| Node.js (local, CI y Lambda) | **24.x** (LTS, soportado en Lambda hasta abril de 2028) | Fijado en `.nvmrc`, `engines`, `setup-node` del CI y `runtime` de CDK. Ver 19.6 |
| pnpm | **12.x**, fijado con `packageManager` en `package.json` | Corepack lo activa: `corepack enable`. pnpm 12 rechaza la instalación si una dependencia trae scripts de instalación no aprobados (`allowBuilds`, 6.12) |
| PostgreSQL | **17** | Local, CI y RDS |
| TypeScript | **`~6.0`** | `target: ES2023`, `module: commonjs`. **No** TypeScript 7: el CLI de Nest 12 fija `~6.0` y `typescript-eslint` no soporta 7 (aunque 7 sí emite `emitDecoratorMetadata`) |
| NestJS | `^12.1` | Se publica como **ESM**; el código de la app sigue compilando a CommonJS (Node 24 admite `require()` de ESM). Ver la trampa del bundle en 22.23 |
| TypeORM | **`1.1.1`** exacto (sin `^`) | Pinned a propósito. Cambios respecto a 0.3 que afectan a este blueprint: `select`/`relations` solo con sintaxis de objeto, `null`/`undefined` en un `where` lanzan error, `findOneById` eliminado |
| Zod | `^4.6` | `z.stringbool()` para booleanos de entorno; los errores se leen en `error.issues` |
| Vitest | `^5.0` | Con `unplugin-swc`: SWC sí emite la metadata de decoradores (esbuild no) |
| `@codegenie/serverless-express` | `^5.0` | Sucesor de `@vendia/serverless-express`. La v5 solo admite handlers con promesa, que es lo que exige Node 24 |
| AWS CDK | `aws-cdk-lib ^2.270`, CLI `aws-cdk ^2.1140`, `cdk-nag ^3` | Infraestructura (sección 16) |
| esbuild | `^0.28` | Empaquetado de las Lambdas (6.11) |
| Runtime de Lambda | `nodejs24.x`, arquitectura `arm64` | Graviton: más rápido por milisegundo y ~20 % más barato que x86 |

> **Por qué Node 24 y no 22.** `nodejs20.x` quedó deprecado en Lambda el 30/04/2026; `nodejs22.x` se depreca el 30/04/2027; `nodejs24.x` el 30/04/2028. Empezar un proyecto en 22 obliga a migrar en meses. Node 24 elimina los handlers con `callback`, por eso el handler de 8.3 es solo `async` y se usa `@codegenie/serverless-express` v5.

> **Versiones exactas de las dependencias.** Los rangos de la sección 4 son los que se verificaron el 07/10/2026. `pnpm install` resolverá la última versión compatible y el `pnpm-lock.yaml` las congela. Dependabot (17.6) las mantiene al día con PRs agrupados y revisables.

```bash
# Verificación de prerrequisitos
node -v              # v24.x (≥ 24.11: lo exige TypeORM 1.x)
corepack enable && pnpm -v   # 12.x
psql --version       # psql (PostgreSQL) 17.x
aws --version        # aws-cli/2.x
npx cdk --version    # 2.x
```

### 3.2 Recursos que deben existir ANTES de escribir código

🆕 **V2** — En la v1 había nueve recursos que se creaban a mano. En la v2 **solo hay tres**, y son de arranque (no se pueden crear con el propio CDK sin un huevo y la gallina). Todo lo demás lo crea la sección 16.

| # | Recurso | Detalle | Lo hace | Bloquea |
|---|---|---|---|---|
| 1 | **Dos cuentas AWS** | `<ACCOUNT_NONPROD>` (dev y qa) y `<ACCOUNT_PROD>`, idealmente bajo AWS Organizations con facturación consolidada y CloudTrail organizativo | Administrador de la nube | Todo despliegue |
| 2 | **Dominio en Route 53** | `<DOMINIO_BASE>` con su zona alojada `<HOSTED_ZONE_ID>`. Si la zona vive en otra cuenta, delegar subdominios (`app-dev`, `app-qa`) a la cuenta no-prod | Administrador de la nube | Certificado y CloudFront |
| 3 | **CDK bootstrap + stack de CI** | `cdk bootstrap` en cada cuenta (en `<REGION>` y en `us-east-1`) y un primer `cdk deploy -c ci=nonprod` / `-c ci=prod` con credenciales de administrador, que crea el proveedor OIDC de GitHub y los roles de despliegue (16.12) | Administrador de la nube, una vez | El CI |

> **Se puede escribir y probar todo el código sin AWS.** Con PostgreSQL local y el fallback de almacenamiento en disco (7.6), las fases 0 a 7 del plan corren en una laptop. Cognito sí es real desde la fase 4: se usa el pool de `dev`, que crea CDK en la fase 9; hasta entonces, los tests de auth usan el cliente de Cognito simulado (15.3).

### 3.3 Secretos y cómo circulan

🆕 **V2**

| Secreto | Local | CI | Lambda |
|---|---|---|---|
| Contraseña de BD de la API | `.env` (`DB_PASSWORD`, solo PostgreSQL local) | **no existe**: el CI nunca toca la base | **no existe**: `app_user` es IAM-only; la Lambda genera un token de 15 min con `@aws-sdk/rds-signer` (7.2) y el proxy entra a la base también con IAM |
| Contraseña del usuario maestro (`postgres`) | — | **no la ve**: el CI solo invoca la Lambda `migrator` | Secrets Manager `/<org>/<app-short>/<stage>/db-master`, generada por RDS/CDK y **rotada cada 30 días**. Solo la lee la Lambda `migrator` (y una persona en emergencia, con rastro en CloudTrail) |
| Secreto del App Client de Cognito | `.env` (`COGNITO_CLIENT_SECRET`) | no se usa | Secrets Manager `/<org>/<app-short>/<stage>/cognito-client-secret`, leído al arrancar |
| Secreto de origen (`x-origin-verify`) | no aplica (sin CloudFront) | no se usa | Secrets Manager `/<org>/<app-short>/<stage>/origin-verify`, leído al arrancar. CloudFront lo envía como cabecera |
| DSN de Sentry | `.env`, opcional | variable del workflow | Variable de entorno (no es secreto) |
| Credenciales AWS | `aws sso login` (perfil) | STS vía OIDC (`aws-actions/configure-aws-credentials`) | Rol de ejecución, inyectado por el runtime |

**No hay access keys estáticas en ningún lugar**, ni contraseñas de base de datos en manos de personas o del CI. Eso es una propiedad del diseño, no un detalle.

---

## 4. `package.json` completo

🆕 **V2** — copiar y ajustar `name` y `author`. Verificado con `pnpm install` el 07/10/2026.

Archivo: `package.json`

```json
{
  "name": "<app>",
  "version": "0.0.1",
  "description": "Backend NestJS sobre AWS Lambda",
  "author": "<AUTOR>",
  "private": true,
  "license": "UNLICENSED",
  "packageManager": "pnpm@12.10.1",
  "engines": {
    "node": ">=24.11.0 <25"
  },
  "scripts": {
    "build": "nest build",
    "bundle": "node scripts/bundle.mjs",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main",
    "lint": "eslint .",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "prepare": "husky",
    "typeorm": "typeorm",
    "migration:generate": "pnpm build && typeorm migration:generate -d dist/config/typeorm.config.js",
    "migration:run": "pnpm build && typeorm migration:run -d dist/config/typeorm.config.js",
    "migration:revert": "pnpm build && typeorm migration:revert -d dist/config/typeorm.config.js",
    "db:seed": "pnpm build && node dist/database/seed.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:cov": "vitest run --coverage",
    "test:e2e": "vitest run --config vitest.e2e.config.mts",
    "test:e2e:cov": "vitest run --config vitest.e2e.config.mts --coverage"
  },
  "dependencies": {
    "@aws-sdk/client-cognito-identity-provider": "^3.1100.0",
    "@aws-sdk/client-s3": "^3.1100.0",
    "@aws-sdk/client-secrets-manager": "^3.1100.0",
    "@aws-sdk/rds-signer": "^3.1100.0",
    "@aws-sdk/s3-request-presigner": "^3.1100.0",
    "@codegenie/serverless-express": "^5.0.0",
    "@nestjs/common": "^12.1.2",
    "@nestjs/config": "^12.0.1",
    "@nestjs/core": "^12.1.2",
    "@nestjs/passport": "^12.0.0",
    "@nestjs/platform-express": "^12.1.2",
    "@nestjs/swagger": "^12.0.2",
    "@nestjs/typeorm": "^12.0.2",
    "@sentry/node": "^11.4.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.15.1",
    "cookie-parser": "^1.4.7",
    "decimal.js": "^10.6.0",
    "express": "^5.2.1",
    "helmet": "^8.3.0",
    "jwks-rsa": "^4.1.0",
    "nestjs-pino": "^5.3.1",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "pg": "^8.23.1",
    "pino": "^10.4.0",
    "pino-http": "^11.0.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.2",
    "typeorm": "1.1.1",
    "typeorm-naming-strategies": "^4.1.0",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@nestjs/cli": "^12.0.8",
    "@nestjs/schematics": "^12.0.6",
    "@nestjs/testing": "^12.1.2",
    "@swc/core": "^1.16.13",
    "@types/aws-lambda": "^8.10.164",
    "@types/cookie-parser": "^1.4.9",
    "@types/express": "^5.0.3",
    "@types/node": "^24.0.0",
    "@types/passport-jwt": "^4.0.1",
    "@types/supertest": "^6.0.3",
    "@vitest/coverage-v8": "^5.0.3",
    "esbuild": "^0.28.2",
    "eslint": "^10.12.0",
    "eslint-config-prettier": "^10.1.8",
    "globals": "^17.13.0",
    "husky": "^9.1.7",
    "pino-pretty": "^13.2.0",
    "prettier": "^3.9.9",
    "supertest": "^7.3.1",
    "typescript": "~6.0.3",
    "typescript-eslint": "^8.71.1",
    "unplugin-swc": "^2.0.0",
    "vitest": "^5.0.3"
  }
}
```

`infra/` es un paquete aparte del mismo workspace (la app CDK, sección 16):

Archivo: `infra/package.json`

```json
{
  "name": "infra",
  "private": true,
  "scripts": {
    "cdk": "cdk",
    "synth": "cdk synth --quiet",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "aws-cdk-lib": "^2.270.0",
    "cdk-nag": "^3.0.2",
    "constructs": "^10.4.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "aws-cdk": "^2.1140.0",
    "tsx": "^4.20.0",
    "typescript": "~6.0.3"
  }
}
```

```yaml
# pnpm-workspace.yaml
packages:
  - infra
allowBuilds:
  '@scarf/scarf': false
  '@swc/core': true
  esbuild: true
```

> **Diferencias deliberadas respecto a la v1** (justificadas en 19 y 27):
> - Node 24, pnpm 12, NestJS 12, TypeORM 1.1.1, TypeScript 6.0, Zod 4.
> - Sin `serverless`, `serverless-offline`, `ts-node`, `dotenv`, `@nestjs/jwt` (no se firma ningún token propio), `@nestjs/throttler` (en Lambda cada contenedor tiene su propia memoria: el límite por IP lo hace WAF, 23.3), `@aws-sdk/client-ssm`.
> - Nuevas: `@codegenie/serverless-express` (Node 24), `@aws-sdk/rds-signer` (IAM auth), `@aws-sdk/client-secrets-manager`, `cookie-parser` (sesión en cookies), `nestjs-pino` + `pino` (logs JSON), `@sentry/node`, `typeorm-naming-strategies`, `express` (declarado: el módulo de documentos usa su `raw()` y pnpm no expone dependencias transitivas), `vitest` + `unplugin-swc` + `@swc/core`, `esbuild`.

### 4.1 Cada script, uno por uno

| Script | Qué hace | Cuándo se usa |
|---|---|---|
| `build` | `nest build` con `tsc`: compila a `dist/` y **emite la metadata de decoradores** | Antes de todo lo demás |
| `bundle` | Empaqueta cada Lambda desde `dist/` en un único `.lambda/<función>/index.js` minificado (6.11) | CI, antes de `cdk deploy` |
| `start:dev` | Servidor local con recarga en `127.0.0.1:3000` | Desarrollo diario |
| `lint` | ESLint con reglas que usan el sistema de tipos | Pre-push, CI |
| `typecheck` | `tsc --noEmit` estricto | Pre-push, CI |
| `migration:generate` | Compila y genera una migración por diff entre entidades y esquema real. Recibe la ruta destino: `pnpm migration:generate src/migrations/AddX` | Al cambiar una entidad |
| `migration:run` / `migration:revert` | Aplica / revierte contra la base del `.env` | Solo en local. En AWS lo hace la Lambda `migrator` |
| `db:seed` | Inserta las claves de `settings` que falten (idempotente) | Tras migrar en local |
| `test` | Unitarios (`src/**/*.spec.ts`) | Desarrollo, CI |
| `test:e2e` / `test:e2e:cov` | E2E contra PostgreSQL real; la variante `:cov` aplica el umbral de cobertura | CI |

> **Por qué el CLI de TypeORM corre sobre `dist/` y no sobre `src/` con ts-node.** `ts-node` no se mantiene al ritmo de TypeScript 6, y las alternativas rápidas (`tsx`, esbuild) **no emiten la metadata de decoradores**: TypeORM perdería los tipos de las columnas que no los declaran y `migration:generate` produciría SQL incorrecto. Compilar con `tsc` y ejecutar el JavaScript resultante es la única forma de que el CLI vea exactamente lo mismo que la app.

> **Por qué `typeorm` está fijado sin `^`.** Cada minor puede cambiar el SQL que genera `migration:generate`. Se sube en un PR propio que regenera una migración de prueba y revisa el diff.

---

## 5. Estructura de carpetas

🆕 **V2**

```
<app>/
├── .cursor/                       # Entorno de Cursor Cloud (18.2)
├── .github/
│   ├── dependabot.yml             # Actualización semanal y agrupada de dependencias
│   └── workflows/
│       ├── ci.yml                 # Verificar en cada PR; construir una vez; promover dev → qa → prod
│       ├── deploy.yml             # Workflow reutilizable: despliega un stage
│       └── codeql.yml             # Análisis estático de seguridad
├── .husky/pre-push                # lint + typecheck + test antes de cada push
├── infra/                         # App CDK (paquete del workspace, sección 16)
│   ├── bin/app.ts
│   ├── lib/                       # Un archivo por stack + config, nombres, nag
│   ├── cdk.json
│   └── package.json
├── scripts/
│   ├── bundle.mjs                 # esbuild: dist/*.js → .lambda/<función>/index.js
│   ├── lambda-smoke.mjs           # Invoca el bundle con un evento de API Gateway v2
│   ├── synth-check.sh             # cdk synth sin AWS (valores ficticios)
│   └── ci/
│       ├── invoke-migrator.sh     # Invoca la Lambda migrator y falla si falla
│       └── smoke.sh               # Prueba el stage a través de CloudFront
├── src/
│   ├── main.ts                    # Entrada local (Swagger en /docs, export de OpenAPI)
│   ├── configure-app.ts           # Configuración HTTP ÚNICA para local y Lambda
│   ├── lambda.ts                  # Handler HTTP (Node 24, solo async)
│   ├── lambda-bootstrap.ts        # Construcción de la app Nest para Lambda
│   ├── lambda-migrator.ts         # Migraciones, roles de BD, seeds, alta de admins
│   ├── lambda-ingest.ts           # Worker de ingesta (SQS)
│   ├── app.module.ts
│   ├── config/                    # Entorno y clientes AWS. Única capa que lee process.env
│   │   ├── env.validation.ts      # Esquema Zod
│   │   ├── database.config.ts     # Opciones de TypeORM (pool, TLS, IAM auth)
│   │   ├── typeorm.config.ts      # DataSource del CLI (se ejecuta compilado)
│   │   ├── hydrate-secrets.ts     # Secretos desde Secrets Manager al arrancar
│   │   ├── secret-error.ts
│   │   └── aws-s3.client.ts       # Cliente S3 + fallback a disco en local
│   ├── common/                    # Transversal. No importa nada de modules/
│   │   ├── auth/                  # Guards, decoradores, roles
│   │   ├── constants/
│   │   ├── database/pg-errors.ts
│   │   ├── filters/
│   │   ├── http/                  # requestId, IP real, filtros de origen y CSRF
│   │   ├── observability/         # Logger (pino) y Sentry
│   │   ├── pagination/
│   │   └── utils/decimal.util.ts
│   ├── database/
│   │   ├── entities.ts            # Lista explícita de entidades
│   │   ├── db-roles.ts            # Rol app_user (IAM-only, solo DML)
│   │   ├── seed-data.ts
│   │   └── seed.ts                # pnpm db:seed (local)
│   ├── migrations/
│   │   ├── index.ts               # Lista explícita y ordenada
│   │   └── <timestamp>-<Nombre>.ts
│   └── modules/
│       ├── auth/
│       ├── users/
│       ├── audit/
│       ├── documents/
│       ├── health/
│       └── <feature>/             # Módulos del dominio (plantilla en 12)
├── test/
│   ├── support/test-app.ts        # App de test con Cognito simulado y JWT locales
│   └── *.e2e-spec.ts
├── .env.example
├── .gitattributes
├── .gitignore
├── .nvmrc                         # 24
├── .prettierrc
├── eslint.config.mjs
├── nest-cli.json
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.mts
└── vitest.e2e.config.mts
```

### 5.1 Rol de cada carpeta y sus reglas de dependencia

| Carpeta | Rol | Regla de dependencia |
|---|---|---|
| `src/config/` | Traduce entorno y credenciales a objetos tipados | **No importa nada de `src/modules/`**. Es la única capa que lee `process.env` (salvo los puntos de entrada `lambda*.ts`/`main.ts`, que solo pasan valores) |
| `src/common/` | Guards, filtros, middleware, decoradores y utilidades puras | **No importa nada de `src/modules/`** |
| `src/modules/<x>/` | Un contexto de negocio: entidades, DTOs, servicio, controlador, módulo | Importa `common/`, `config/` y otros módulos por `imports:` del `@Module` |
| `src/database/` | Registro de entidades, roles de BD, seeds | Importa entidades de `modules/` |
| `src/migrations/` | SQL versionado | Solo `typeorm` |
| `infra/` | Infraestructura | **No importa nada de `src/`**. Solo consume `.lambda/` como artefacto |
| `scripts/ci/` | Pasos del despliegue, en bash auditable | AWS CLI y `jq` |

---

## 6. Archivos de configuración del proyecto

🆕 **V2** — copiar todos. El compilador es `tsc` (emite metadata de decoradores). ESLint usa el servicio de tipos y **no** analiza `infra/` ni las migraciones generadas.

### 6.1 `tsconfig.json` y `tsconfig.build.json`

Archivo: `tsconfig.json`

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2023",
    "lib": ["ES2023"],
    "types": ["node"],
    "declaration": false,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "esModuleInterop": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "incremental": true,
    "tsBuildInfoFile": "./dist/.tsbuildinfo",
    "skipLibCheck": true,
    "strict": true,
    "strictPropertyInitialization": false,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "**/*.spec.ts"]
}
```

Archivo: `tsconfig.build.json`

```json
{ "extends": "./tsconfig.json", "exclude": ["node_modules", "test", "dist", "**/*.spec.ts"] }
```

`strictPropertyInitialization` está apagado porque las propiedades de las entidades las rellena TypeORM, no el constructor. El resto de `strict` sigue activo. No se declara `moduleResolution`: con `"module": "commonjs"` y TypeScript 6 el valor por defecto es el correcto; fijar `node16` obliga a cambiar también `module` y rompe el emit CommonJS.

`include` es solo `src/**/*.ts`. Los tests viven fuera y los compila Vitest (SWC), no `tsc`. Por eso `tsc --noEmit` no typecheckea `test/`: el typecheck de los tests lo hace el propio `vitest` al transpilar, y ESLint sí los cubre con el project service (6.3).

### 6.2 `nest-cli.json`

Archivo: `nest-cli.json`

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true,
    "builder": "tsc",
    "tsConfigPath": "tsconfig.build.json"
  }
}
```

`builder: tsc` es obligatorio. El builder `swc` del CLI de Nest **no** emite `emitDecoratorMetadata` y TypeORM pierde los tipos de columna.

### 6.3 `eslint.config.mjs`

```mjs
// eslint.config.mjs
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', '.lambda/**', 'coverage/**', 'infra/cdk.out*/**', 'infra-synth/**', 'src/migrations/*-*.ts'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-unsafe-function-type': 'off',
      'no-console': ['error', { allow: ['error'] }],
    },
  },
  {
    files: ['**/*.spec.ts', 'test/**/*.ts', 'scripts/**/*.mjs', '*.mts', '*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: { 'no-console': 'off', '@typescript-eslint/no-unsafe-member-access': 'off' },
  },
  prettier,
);
```

`src/migrations/*-*.ts` se ignora: son archivos generados. El arreglo a mano del trigger de `audit_logs` (11.4) vive en ese archivo; se revisa en el PR de la migración, no con el linter.

`infra/` tiene su propio `tsconfig` y no entra en este ESLint (el project service fallaría al mezclar las dos raíces). El gate de `infra/` es `tsc -p infra/tsconfig.json`, que ya corre `scripts/synth-check.sh` y el job de CI.

### 6.4 Prettier, Node y fin de línea

Archivo: `.prettierrc`

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

```text
24
```

`.gitattributes` (crear; no es un archivo del proyecto de verificación, es convención de repositorio):

```
* text=auto eol=lf
*.sh text eol=lf
```

Sin esto, un checkout en Windows convierte los scripts a CRLF y `bash` falla con `$'\r': command not found` (22.16).

### 6.5 `.gitignore`

```
node_modules/
dist/
.lambda/
coverage/
infra/cdk.out*/
infra-synth/
*.tsbuildinfo
.env
.env.*
!.env.example
.local-uploads/
```

`.env` no se commitea. `.env.example` sí.

### 6.6 `.env.example`

Valores de **local**. En AWS ninguna de estas variables de secreto existe: las Lambdas reciben ARNs y leen Secrets Manager al arrancar (7.4).

```
NODE_ENV=development
STAGE=local
PORT=3000
LOG_LEVEL=debug
APP_ORIGIN=http://127.0.0.1:4200
AWS_REGION=<REGION>
DOCS_BUCKET=local
COGNITO_USER_POOL_ID=
COGNITO_CLIENT_ID=
COGNITO_CLIENT_SECRET=
AUTH_SELF_SIGNUP=true
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_NAME=<app_snake>
DB_IAM_AUTH=false
DB_SSL=false
```

`APP_ORIGIN` es el origen del **frontend**. En local Nuxt (127.0.0.1:4200) hace de proxy de `/api` hacia el puerto 3000, así que el navegador habla con un solo origen y las cookies `SameSite=Strict` viajan. `DB_IAM_AUTH=false` solo es válido en `local` y `test`.

### 6.7 Husky

`package.json` declara `"prepare": "husky"`. El hook de pre-push corre lo rápido; la suite e2e (PostgreSQL) queda en CI.

```sh
# .husky/pre-push
pnpm lint && pnpm typecheck && pnpm test
```

### 6.8 Vitest

```ts
// vitest.config.mts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC (no esbuild) porque Nest y TypeORM necesitan emitDecoratorMetadata.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/migrations/**', 'src/main.ts', 'src/lambda*.ts', 'src/**/*.module.ts'],
    },
  },
});
```

```ts
// vitest.e2e.config.mts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.e2e-spec.ts'],
    environment: 'node',
    // Comparten una base de datos real: en serie.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/migrations/**', 'src/main.ts', 'src/lambda*.ts', 'src/**/*.spec.ts', 'src/database/seed.ts'],
      // Umbral mínimo del CI. Subirlo a medida que crezca la suite; nunca bajarlo.
      thresholds: { lines: 70, functions: 70, branches: 50 },
    },
  },
});
```

Los umbrales viven **solo** en la config e2e. Ponerlos en la config de unitarios hace fallar el job en cuanto la cobertura se mide sobre un subconjunto. Los números medidos el 07/10/2026, con esta misma suite: líneas 78.22 %, ramas 58.86 %, funciones 85.46 %, sentencias 75.1 %. El umbral de ramas está en 50 a propósito: se sube cuando la suite crezca, no se baja.

`fileParallelism: false` porque todos los e2e comparten una base real y cada archivo hace `DROP SCHEMA public CASCADE` en el `beforeAll`.

### 6.9 No hay Dockerfile

🟥 **DEUDA — NO REPLICAR.** El original tenía un Dockerfile de una imagen que nadie desplegaba, con una versión de Node distinta a la de Lambda. El runtime es Lambda (Node 24) y el desarrollo local es `pnpm start:dev`. No añadir un Dockerfile "por si acaso": divergiría del runtime real.

### 6.10 `infra/tsconfig.json`

Archivo: `infra/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "commonjs",
    "lib": ["ES2023"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noImplicitOverride": true
  },
  "include": ["bin/**/*.ts", "lib/**/*.ts", "test/**/*.ts"]
}
```

`noEmit: true`: CDK ejecuta TypeScript con `tsx` (`cdk.json` → `npx tsx bin/app.ts`). No hay un `dist/` de infraestructura.

### 6.11 Empaquetado de las Lambdas

```mjs
// scripts/bundle.mjs
// Empaqueta cada Lambda en un único archivo minificado a partir de dist/ (ya compilado por tsc,
// que es quien emite la metadata de decoradores que esbuild no sabe generar).
// Uso: pnpm build && pnpm bundle   →   .lambda/<función>/index.js
import { build } from 'esbuild';
import { rmSync, statSync } from 'node:fs';

const FUNCTIONS = {
  api: 'dist/lambda.js',
  migrator: 'dist/lambda-migrator.js',
  'ingest-worker': 'dist/lambda-ingest.js',
  // 'job-<nombre>': 'dist/lambda-<nombre>.js',
};

// Paquetes opcionales que Nest y TypeORM intentan cargar con require() dinámico
// y que esta aplicación no usa. Marcarlos como externos evita errores de bundle;
// como nunca se cargan en runtime, no hace falta que existan en el zip.
const OPTIONAL = [
  '@nestjs/microservices',
  '@nestjs/microservices/*',
  '@nestjs/websockets',
  '@nestjs/websockets/*',
  '@fastify/static',
  '@fastify/view',
  'class-transformer/storage',
  'cache-manager',
  '@sap/hana-client',
  '@sap/hana-client/*',
  'better-sqlite3',
  'hdb-pool',
  'ioredis',
  'mongodb',
  'mssql',
  'mysql2',
  'oracledb',
  'pg-native',
  'pg-query-stream',
  'redis',
  'sql.js',
  'sqlite3',
  'typeorm-aurora-data-api-driver',
  '@google-cloud/spanner',
  'react-native-sqlite-storage',
  'pino-pretty',
];

rmSync('.lambda', { recursive: true, force: true });

for (const [name, entry] of Object.entries(FUNCTIONS)) {
  const outfile = `.lambda/${name}/index.js`;
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    minify: true,
    // IMPRESCINDIBLE: Nest deriva tokens de inyección del nombre de clase
    // (getRepositoryToken) y TypeORM registra las migraciones por nombre de clase.
    // Sin keepNames, la minificación renombra clases y ambos fallan.
    keepNames: true,
    sourcemap: 'linked',
    legalComments: 'none',
    external: OPTIONAL,
    // NestJS 12 se publica como ESM y usa createRequire(import.meta.url). En un
    // bundle CommonJS import.meta está vacío: se reconstruye desde __filename.
    banner: { js: 'const __bundleMetaUrl=require("node:url").pathToFileURL(__filename).href;' },
    define: { 'import.meta.url': '__bundleMetaUrl' },
    logLevel: 'warning',
  });
  const kb = Math.round(statSync(outfile).size / 1024);
  console.log(`${name.padEnd(16)} ${outfile}  ${kb} KB`);
}
```

Orden obligatorio: `pnpm build && pnpm bundle`. esbuild **no** emite metadata de decoradores; por eso el entry es `dist/*.js`, ya compilado por `tsc`.

Tres detalles que, si se quitan, el bundle arranca y revienta en la primera petición:

1. **`keepNames: true`.** Nest calcula el token de `getRepositoryToken(User)` a partir del nombre de la clase. TypeORM registra cada migración por `constructor.name`. Minificar sin conservar nombres hace que los repositorios no se resuelvan y que el migrator no encuentre ninguna migración.
2. **El banner de `import.meta.url`.** NestJS 12 se publica como ESM y llama a `createRequire(import.meta.url)` dentro de `loadPackageSync`. En un bundle CommonJS `import.meta.url` queda `undefined` y el `require` resuelve contra el cwd. El banner reconstruye la URL desde `__filename` y `define` sustituye la expresión.
3. **`pino-pretty` como external, y solo se activa fuera de Lambda.** El transport de `pino-pretty` lanza un worker thread que busca `pino-pretty/lib/worker.js` dentro del bundle y no lo encuentra. `app.module.ts` lo enciende únicamente cuando `STAGE=local` y no hay `AWS_LAMBDA_FUNCTION_NAME`.

`scripts/lambda-smoke.mjs` invoca el bundle con un evento de API Gateway HTTP API (payload 2.0) y con los eventos del migrator. Es el mismo script que produjo el humo de la sección 21: arranque en frío 411 ms, caliente 2 ms, 401 sin cookie, 403 sin la cabecera de CloudFront.

```mjs
// scripts/lambda-smoke.mjs
// Invoca el bundle de la Lambda con eventos sintéticos de API Gateway HTTP API (payload v2).
// Uso: pnpm build && pnpm bundle && node --env-file=.env scripts/lambda-smoke.mjs
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

process.env.AWS_LAMBDA_FUNCTION_NAME ??= 'smoke-api';
const require = createRequire(import.meta.url);

function event(method, path, headers = {}) {
  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: path,
    rawQueryString: '',
    headers: {
      host: 'smoke.local',
      'x-forwarded-proto': 'https',
      'x-origin-verify': process.env.ORIGIN_VERIFY_SECRET ?? '',
      ...headers,
    },
    requestContext: {
      accountId: '000000000000',
      apiId: 'smoke',
      domainName: 'smoke.local',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'smoke' },
      requestId: `req-${Math.random().toString(36).slice(2)}`,
      routeKey: '$default',
      stage: '$default',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
  };
}
const context = { awsRequestId: 'smoke', functionName: 'smoke-api', getRemainingTimeInMillis: () => 29000 };

const t0 = performance.now();
const { handler } = require('../.lambda/api/index.js');
const tLoad = performance.now();
const cold = await handler(event('GET', '/api/health'), context);
const tCold = performance.now();
const warm = await handler(event('GET', '/api/health'), context);
const tWarm = performance.now();
const unauth = await handler(event('GET', '/api/auth/me'), context);
const bypass = await handler(event('GET', '/api/health', { 'x-origin-verify': 'wrong' }), context);

console.log(`carga del módulo:          ${(tLoad - t0).toFixed(0)} ms`);
console.log(`1.ª invocación (bootstrap): ${(tCold - tLoad).toFixed(0)} ms -> ${cold.statusCode} ${cold.body}`);
console.log(`2.ª invocación (caliente):  ${(tWarm - tCold).toFixed(1)} ms -> ${warm.statusCode}`);
console.log(`/api/auth/me sin cookie:    ${unauth.statusCode} ${unauth.body}`);
console.log(`sin cabecera de CloudFront: ${bypass.statusCode} ${bypass.body}`);
console.log(`cabeceras:                  x-request-id=${cold.headers['x-request-id']} cache-control=${cold.headers['cache-control']}`);
process.exit(cold.statusCode === 200 && warm.statusCode === 200 && unauth.statusCode === 401 && bypass.statusCode === 403 ? 0 : 1);
```

---
## 7. Capa de configuración (`src/config/`)

🆕 **V2.** Es la única capa que lee `process.env` (junto con los puntos de entrada, que solo reenvían). Ningún módulo de negocio importa el SDK de AWS ni abre `process.env`.

### 7.1 Esquema de entorno

```ts
// src/config/env.validation.ts
import { z } from 'zod';

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    STAGE: z.enum(['local', 'test', 'dev', 'qa', 'prod']).default('local'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    RELEASE: optionalString,

    // Origen público del frontend. En local es el dev server de Nuxt, que hace
    // proxy de /api al backend; en AWS es https://<DOMINIO_APP>.
    APP_ORIGIN: z.url({ message: 'APP_ORIGIN debe ser una URL (https://…)' }),

    AWS_REGION: z.string().default('<REGION>'),
    AWS_ACCESS_KEY_ID: optionalString,
    AWS_SECRET_ACCESS_KEY: optionalString,
    DOCS_BUCKET: z.string().min(1, 'DOCS_BUCKET es requerido'),

    COGNITO_USER_POOL_ID: z.string().min(1, 'COGNITO_USER_POOL_ID es requerido'),
    COGNITO_CLIENT_ID: z.string().min(1, 'COGNITO_CLIENT_ID es requerido'),
    COGNITO_CLIENT_SECRET: z
      .string()
      .min(1, 'COGNITO_CLIENT_SECRET es requerido (o COGNITO_CLIENT_SECRET_ARN en AWS)'),
    AUTH_SELF_SIGNUP: z.stringbool().default(true),

    DB_HOST: z.string().min(1, 'DB_HOST es requerido'),
    DB_PORT: z.coerce.number().int().positive().default(5432),
    DB_USERNAME: z.string().min(1, 'DB_USERNAME es requerido'),
    DB_PASSWORD: optionalString,
    DB_NAME: z.string().min(1, 'DB_NAME es requerido'),
    DB_IAM_AUTH: z.stringbool().default(false),
    DB_SSL: z.stringbool().default(false),
    DB_POOL_MAX: z.coerce.number().int().positive().optional(),

    ORIGIN_VERIFY_SECRET: optionalString,
    SENTRY_DSN: optionalString,
  })
  .superRefine((env, ctx) => {
    if (!env.DB_IAM_AUTH && !env.DB_PASSWORD) {
      ctx.addIssue({
        code: 'custom',
        path: ['DB_PASSWORD'],
        message: 'DB_PASSWORD es requerido cuando DB_IAM_AUTH=false',
      });
    }
    if (env.DB_IAM_AUTH && !env.DB_SSL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DB_SSL'],
        message: 'La autenticación IAM exige DB_SSL=true',
      });
    }
    const deployed = ['dev', 'qa', 'prod'].includes(env.STAGE);
    if (deployed && !env.ORIGIN_VERIFY_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['ORIGIN_VERIFY_SECRET'],
        message: 'En dev/qa/prod la API solo acepta tráfico que venga de CloudFront',
      });
    }
    if (deployed && !env.APP_ORIGIN.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_ORIGIN'],
        message: 'En dev/qa/prod APP_ORIGIN debe ser https://',
      });
    }
  });

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - [${issue.path.join('.')}]: ${issue.message}`,
    );
    throw new Error(`Configuración inválida en variables de entorno:\n${lines.join('\n')}`);
  }
  return result.data;
}
```

```ts
// src/config/env.validation.spec.ts
import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.validation';

const base = {
  APP_ORIGIN: 'http://127.0.0.1:4200',
  DOCS_BUCKET: 'b',
  COGNITO_USER_POOL_ID: 'p',
  COGNITO_CLIENT_ID: 'c',
  COGNITO_CLIENT_SECRET: 's',
  DB_HOST: 'localhost',
  DB_USERNAME: 'postgres',
  DB_PASSWORD: 'postgres',
  DB_NAME: 'db',
};

describe('validateEnv', () => {
  it('acepta un entorno local mínimo y aplica defaults tipados', () => {
    const env = validateEnv(base);
    expect(env.DB_PORT).toBe(5432);
    expect(env.DB_IAM_AUTH).toBe(false);
    expect(env.STAGE).toBe('local');
  });

  it('nombra todas las variables que faltan', () => {
    expect(() => validateEnv({})).toThrow(/APP_ORIGIN[\s\S]*COGNITO_USER_POOL_ID[\s\S]*DB_HOST/);
  });

  it('en un stage desplegado exige https y el secreto de origen', () => {
    expect(() => validateEnv({ ...base, STAGE: 'prod' })).toThrow(
      /ORIGIN_VERIFY_SECRET[\s\S]*https/,
    );
  });

  it('IAM auth no requiere contraseña pero sí TLS', () => {
    const { DB_PASSWORD: _omit, ...noPassword } = base;
    expect(() => validateEnv({ ...noPassword, DB_IAM_AUTH: 'true' })).toThrow(/DB_SSL/);
    expect(validateEnv({ ...noPassword, DB_IAM_AUTH: 'true', DB_SSL: 'true' }).DB_IAM_AUTH).toBe(
      true,
    );
  });
});
```

Decisiones que el esquema fija y que el resto del código da por hechas:

- `NODE_ENV` es el modo de Node (`development` | `production` | `test`). `STAGE` es el entorno de la aplicación (`local` | `test` | `dev` | `qa` | `prod`). En la v1 ambos conceptos estaban mezclados en `NODE_ENV` y un `NODE_ENV=production` local se comportaba como prod.
- `z.stringbool()` (Zod 4) acepta `true`/`false`/`1`/`0`. Las variables de entorno siempre llegan como string.
- `DB_PASSWORD` es obligatoria solo cuando `DB_IAM_AUTH=false`. En AWS la Lambda de la API no tiene contraseña.
- `DB_IAM_AUTH` exige `DB_SSL`: RDS Proxy con IAM autentica dentro del túnel TLS. Sin TLS el token no sirve y, peor, viajaría en claro.
- En `dev`/`qa`/`prod`, `ORIGIN_VERIFY_SECRET` es obligatorio y `APP_ORIGIN` tiene que ser `https://`. Sin el secreto, la API aceptaría tráfico que no viene de CloudFront.

`ConfigModule.forRoot({ validate: validateEnv })` llama a esta función con `process.env` al arrancar. Si falla, el proceso termina antes de escuchar: una Lambda mal configurada no llega a atender una sola petición.

### 7.2 Conexión a PostgreSQL

```ts
// src/config/database.config.ts
import type { DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
export interface DbEnv {
  DB_HOST: string;
  DB_PORT: number;
  DB_USERNAME: string;
  DB_PASSWORD?: string;
  DB_NAME: string;
  DB_IAM_AUTH: boolean;
  DB_SSL: boolean;
  DB_POOL_MAX?: number;
  AWS_REGION: string;
  STAGE: string;
}

const isLambda = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

/**
 * Con IAM auth, `pg` llama a esta función cada vez que abre una conexión
 * física. El token dura 15 minutos, pero una conexión ya abierta sigue viva
 * aunque el token expire: solo las conexiones nuevas necesitan uno fresco.
 */
function iamPasswordProvider(env: DbEnv): () => Promise<string> {
  let signerPromise: Promise<{ getAuthToken(): Promise<string> }> | undefined;
  return async () => {
    signerPromise ??= import('@aws-sdk/rds-signer').then(
      ({ Signer }) =>
        new Signer({
          region: env.AWS_REGION,
          hostname: env.DB_HOST,
          port: env.DB_PORT,
          username: env.DB_USERNAME,
        }),
    );
    return (await signerPromise).getAuthToken();
  };
}

export function buildDataSourceOptions(env: DbEnv): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USERNAME,
    password: env.DB_IAM_AUTH ? undefined : env.DB_PASSWORD,
    database: env.DB_NAME,
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    migrationsRun: false,
    // gen_random_uuid() es nativa desde PostgreSQL 13: no requiere extensiones.
    uuidExtension: 'pgcrypto',
    // Sin esto TypeORM intenta CREATE EXTENSION en cada arranque, y app_user no tiene permiso.
    installExtensions: false,
    logging: ['error', 'warn', 'migration'],
    // El proxy presenta un certificado de ACM (Amazon Trust Services), que ya
    // está en el almacén de confianza de Node: se valida la cadena completa.
    ssl: env.DB_SSL ? { rejectUnauthorized: true } : false,
    applicationName: `${env.STAGE}-${process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'local'}`,
    poolSize: env.DB_POOL_MAX ?? (isLambda ? 3 : 10),
    connectTimeoutMS: 5_000,
    extra: {
      idleTimeoutMillis: isLambda ? 60_000 : 30_000,
      statement_timeout: 10_000,
      lock_timeout: 5_000,
      idle_in_transaction_session_timeout: 15_000,
      ...(env.DB_IAM_AUTH ? { password: iamPasswordProvider(env) } : {}),
    },
  };
}
```

Lo que hay que entender para no "simplificarlo":

- **El token IAM es una función, no un string.** `pg` ≥ 7.12 acepta `password` como `() => Promise<string>`. El token dura 15 minutos; un string fijado al arrancar caduca y el pool se queda mudo hasta el siguiente cold start. Se pasa por `extra.password` porque el driver de TypeORM para Postgres **pisa** `credentials.password` con el valor de `extra.password` (verificado en `PostgresDriver.js` de TypeORM 1.1.1).
- **El pool es pequeño en Lambda.** `poolSize` 3 cuando existe `AWS_LAMBDA_FUNCTION_NAME`, 10 en local. RDS Proxy está delante precisamente para que N contenedores con 3 conexiones no agoten `max_connections`. Subir el pool "para ir más rápido" hace lo contrario: agota el proxy.
- **`statement_timeout` 10 s** dentro de `extra.options`. Una query olvidada no puede ocupar una conexión hasta el timeout de 30 s de API Gateway.
- **`uuidExtension: 'pgcrypto'` e `installExtensions: false`.** Así `migration:generate` emite `gen_random_uuid()` (built-in desde PostgreSQL 13) y no `uuid_generate_v4()` ni un `CREATE EXTENSION` que el rol de la app no puede ejecutar. La extensión `pgcrypto` la instala el usuario maestro, una vez, en la migración inicial.
- **`ssl: { rejectUnauthorized: true }`** en AWS. El trust store lo aporta `NODE_EXTRA_CA_CERTS` apuntando al bundle de CA de Amazon que CDK deja en la Lambda (16.4). En local, contra un PostgreSQL sin TLS, `DB_SSL=false`.

### 7.3 DataSource del CLI

```ts
// src/config/typeorm.config.ts
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { ENTITIES } from '../database/entities';
import { MIGRATIONS } from '../migrations';
import { buildDataSourceOptions } from './database.config';
import { validateEnv } from './env.validation';

// DataSource del CLI de TypeORM. Se ejecuta COMPILADO (dist/config/typeorm.config.js):
// así la metadata de decoradores la emite tsc y no hace falta ts-node.
if (existsSync('.env')) process.loadEnvFile('.env');
const env = validateEnv(process.env);

export default new DataSource({
  ...buildDataSourceOptions(env),
  entities: ENTITIES,
  migrations: MIGRATIONS,
});
```

Se ejecuta **compilado**: `typeorm -d dist/config/typeorm.config.js`. Ver la nota de la sección 4 sobre por qué no se usa ts-node. El CLI solo corre en local (`migration:generate`, `migration:run`, `migration:revert`). En AWS el mismo `buildDataSourceOptions` lo usa la Lambda `migrator`, con otras credenciales (11.3).

### 7.4 Secretos al arrancar

```ts
// src/config/hydrate-secrets.ts
import { formatSecretError } from './secret-error';

/**
 * Variable de entorno destino → variable que trae el ARN del secreto.
 * CDK pone el ARN en la Lambda; el valor nunca aparece en su configuración.
 */
const SECRET_SOURCES = {
  COGNITO_CLIENT_SECRET: 'COGNITO_CLIENT_SECRET_ARN',
  ORIGIN_VERIFY_SECRET: 'ORIGIN_VERIFY_SECRET_ARN',
} as const;

type SecretKey = keyof typeof SECRET_SOURCES;

function hasValue(value: string | undefined): boolean {
  return Boolean(value && value.trim() && !value.startsWith('<RELLENAR'));
}

/**
 * Rellena process.env con los secretos de Secrets Manager que falten.
 * En local no hace nada (los valores vienen de .env y no hay ARNs).
 * Debe llamarse ANTES de NestFactory.create(): la validación de entorno los exige.
 */
export async function hydrateSecrets(): Promise<void> {
  const pending = (Object.keys(SECRET_SOURCES) as SecretKey[]).filter(
    (key) => !hasValue(process.env[key]) && hasValue(process.env[SECRET_SOURCES[key]]),
  );
  if (pending.length === 0) return;

  const { SecretsManagerClient, GetSecretValueCommand } =
    await import('@aws-sdk/client-secrets-manager');
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION });

  await Promise.all(
    pending.map(async (key) => {
      const secretId = process.env[SECRET_SOURCES[key]] as string;
      try {
        const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
        if (!res.SecretString) throw new Error('el secreto no tiene SecretString');
        process.env[key] = res.SecretString;
      } catch (error) {
        throw new Error(formatSecretError(secretId, error), { cause: error });
      }
    }),
  );
}
```

```ts
// src/config/secret-error.ts
export function formatSecretError(secretId: string, error: unknown): string {
  const err = error as { name?: string; message?: string };
  const code = err.name ?? 'Error';
  const detail = err.message ?? String(error);

  if (code === 'AccessDeniedException') {
    return (
      `Sin permiso para leer ${secretId} (${code}). ` +
      'El rol de la Lambda necesita secretsmanager:GetSecretValue sobre ese ARN ' +
      '(CDK lo concede con secret.grantRead(fn)).'
    );
  }
  if (code === 'ResourceNotFoundException') {
    return `No existe el secreto ${secretId}. ¿Se desplegó el stack de auth/api de este stage?`;
  }
  if (/kms|decrypt/i.test(`${code} ${detail}`)) {
    return (
      `No se pudo descifrar ${secretId} (${code}). ` +
      'Si el secreto usa una clave KMS propia, el rol necesita kms:Decrypt sobre esa clave.'
    );
  }
  if (/timed? ?out|ETIMEDOUT|ECONNREFUSED|getaddrinfo/i.test(detail)) {
    return (
      `No hay conexión con Secrets Manager para leer ${secretId} (${detail}). ` +
      'La Lambda está en subredes privadas: revisar el NAT Gateway o el VPC endpoint de secretsmanager.'
    );
  }
  return `No se pudo leer ${secretId} (${code}): ${detail}`;
}
```

Se hidratan dos secretos, y solo si la variable de entorno trae un ARN (en local no hay ARN y se usan los valores del `.env`):

| Variable de entorno (ARN) | Variable que rellena | Quién la lee |
|---|---|---|
| `COGNITO_CLIENT_SECRET_ARN` | `COGNITO_CLIENT_SECRET` | Firma `SECRET_HASH` de Cognito |
| `ORIGIN_VERIFY_SECRET_ARN` | `ORIGIN_VERIFY_SECRET` | La API comprueba que la petición viene de CloudFront |

La contraseña de base de datos **no** está en esta lista: la API no la tiene. El usuario maestro vive en otro secreto y solo lo lee el migrator, en cada invocación, sin caché (11.3).

Un fallo de Secrets Manager aborta el arranque con un mensaje que dice el ARN y el código de error, y no imprime el secreto. Cachear el cliente entre invocaciones calientes está bien; cachear el valor del secreto de Cognito también (no rota en cada request). El del usuario maestro no se cachea.

### 7.5 Cliente S3

```ts
// src/config/aws-s3.client.ts
import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function isUsableSecret(value: string | undefined): value is string {
  const trimmed = value?.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('<')) return false;
  return trimmed.length >= 16;
}

export function buildS3ClientConfig(): S3ClientConfig {
  const region = process.env.AWS_REGION || '<REGION>';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AWS_SESSION_TOKEN?.trim();

  // No pasar accessKey/secret vacíos: el SDK los trata como credenciales
  // resueltas e inválidas ("Resolved credential object is not valid") y
  // además anula la cadena por defecto (perfil ~/.aws, rol Lambda, SSO).
  // Sin esto, el SDK v3 (≥ 3.729) añade por defecto un checksum CRC32 calculado sobre
  // un cuerpo vacío a las URLs presignadas, y el PUT del navegador falla con 400.
  const integrity = {
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  } as const;

  if (!isUsableSecret(accessKeyId) || !isUsableSecret(secretAccessKey)) {
    return { region, ...integrity };
  }

  return {
    region,
    ...integrity,
    credentials: {
      accessKeyId: accessKeyId.trim(),
      secretAccessKey: secretAccessKey.trim(),
      ...(sessionToken ? { sessionToken } : {}),
    },
  };
}

let cachedClient: S3Client | undefined;

export function getS3Client(): S3Client {
  cachedClient ??= new S3Client(buildS3ClientConfig());
  return cachedClient;
}

export function hasAwsCredentialSource(): boolean {
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return true;
  if (
    isUsableSecret(process.env.AWS_ACCESS_KEY_ID) &&
    isUsableSecret(process.env.AWS_SECRET_ACCESS_KEY)
  ) {
    return true;
  }
  if (process.env.AWS_PROFILE?.trim()) return true;
  const credsFile = path.join(os.homedir(), '.aws', 'credentials');
  if (!fs.existsSync(credsFile)) return false;
  try {
    const content = fs.readFileSync(credsFile, 'utf8');
    return content.includes('aws_access_key_id') && content.includes('aws_secret_access_key');
  } catch {
    return false;
  }
}

/** En local, sin perfil ni keys, la ingesta guarda el archivo en disco. */
export function shouldUseLocalDocumentStorage(): boolean {
  if (process.env.STORAGE_DRIVER === 'local') return true;
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return false;
  if (['dev', 'qa', 'prod'].includes(process.env.STAGE ?? '')) return false;
  return !hasAwsCredentialSource();
}

export function localUploadDir(): string {
  return path.join(process.cwd(), '.local-uploads');
}

export function localUploadPath(s3Key: string): string {
  return path.join(localUploadDir(), ...s3Key.split('/'));
}
```

`requestChecksumCalculation: 'WHEN_REQUIRED'` y `responseChecksumValidation: 'WHEN_REQUIRED'`. A partir del SDK v3.729 el cliente añade por su cuenta una cabecera `x-amz-checksum-crc32` a los PUT. Esa cabecera no forma parte de la URL prefirmada que firma el backend, el navegador no la envía, y S3 responde 403. Con `WHEN_REQUIRED` el SDK solo añade checksum cuando la operación lo exige. La URL prefirmada firma **explícitamente** `content-type`, `content-length` y `x-amz-checksum-sha256` (13.3).

En `STAGE=local` o `test` no hay bucket: el módulo de documentos escribe en `.local-uploads/` y el worker de ingesta se simula en proceso. Así la suite e2e no necesita AWS.

---
## 8. Bootstrap: `configure-app.ts`, `main.ts`, `lambda.ts`, `app.module.ts`

🆕 **V2.** Hay **una** configuración HTTP. Local y Lambda la comparten. Lo que cambia es el adaptador de entrada.

### 8.1 `configure-app.ts`

```ts
// src/configure-app.ts
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

/**
 * Configuración HTTP ÚNICA para los dos caminos de arranque (local y Lambda).
 * Si algo se configura fuera de esta función, local y producción divergen.
 */
export function configureApp(app: INestApplication): void {
  const express = app as NestExpressApplication;

  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');
  express.disable('x-powered-by');
  // Detrás de API Gateway la IP de la conexión no es la del usuario; la real
  // se lee de CloudFront-Viewer-Address (common/http/client-ip.ts).
  express.set('trust proxy', false);

  // El filtro de origen (CloudFront) y el de CSRF son middleware de Nest
  // registrados en AppModule (EdgeGuardsMiddleware), detrás del logger.
  // 1. Cabeceras de seguridad de la API. La CSP del HTML la pone CloudFront.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
      strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: true },
    }),
  );
  // 2. Cookies de sesión.
  app.use(cookieParser());
  // 3. Las respuestas de la API nunca se cachean en navegadores ni en CDNs.
  app.use((_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
}
```

Orden, y por qué:

1. Prefijo global `api`. La ruta pública es `/api/...` tanto en local (el proxy de Nuxt) como en CloudFront (el behavior `/api/*`).
2. `trust proxy` queda en `false`. Detrás de API Gateway la IP del cliente no se lee de `X-Forwarded-For` (cualquiera puede falsificarla): se lee de `CloudFront-Viewer-Address`, que solo puede escribir CloudFront (9.2).
3. Helmet con CSP `default-src 'none'` y `useDefaults: false`. Una API JSON no sirve HTML. Si se dejan los defaults de Helmet, la CSP hereda `script-src 'self'` y similares, que no aportan nada y enmascaran el hecho de que esta respuesta no es un documento. `frame-ancestors 'none'` evita que un sitio embeba una respuesta.
4. `cookie-parser` antes de los guards: el JWT se lee de la cookie.
5. `Cache-Control: no-store` en todas las respuestas de la API. Una respuesta autenticada cacheada en un proxy intermedio es una fuga.
6. `ValidationPipe` global: `whitelist`, `forbidNonWhitelisted`, `transform`. Un campo de más en el body es 400, no se descarta en silencio.
7. Filtro de excepciones global (9.4).
8. `enableShutdownHooks` para que el pool se cierre cuando Lambda congele el entorno tras un `SIGTERM`.

**No hay `enableCors`.** El navegador habla con el mismo origen que sirve el HTML (CloudFront, o el dev server de Nuxt). Una petición same-origin simple no dispara preflight. Añadir CORS "por si el front se despliega en otro dominio" reabre el problema que esta arquitectura cerró.

Origen y CSRF no se aplican aquí con `app.use`. Se aplican como middleware de Nest (9.2) para que corran **después** de que pino haya asignado el `requestId`. Si corren antes, un 403 de CSRF sale sin `requestId` y no se puede correlacionar.

### 8.2 `main.ts` (local y exportación OpenAPI)

```ts
// src/main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'node:fs';
import { AppModule } from './app.module';
import { initSentry } from './common/observability/sentry';
import { configureApp } from './configure-app';

async function bootstrap() {
  await initSentry({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.STAGE ?? 'local',
    release: process.env.RELEASE,
  });
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('<app-short> API')
      .setVersion(process.env.RELEASE ?? 'local')
      .addCookieAuth('<app-short>_at')
      .build(),
  );
  SwaggerModule.setup('docs', app, document);
  // El contrato OpenAPI se versiona: el frontend genera sus tipos a partir de él (17.3).
  if (process.env.OPENAPI_OUT) {
    writeFileSync(process.env.OPENAPI_OUT, JSON.stringify(document, null, 2));
    await app.close();
    return;
  }

  await app.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
}

void bootstrap();
```

Dos modos:

- **`OPENAPI_OUT` definido:** arranca la app, escribe el OpenAPI 3 y termina. No escucha. Es el paso de CI que publica `openapi.json` como artefacto (el contrato que consume el frontend). No requiere base de datos alcanzable: TypeORM no conecta hasta la primera query.
- **Sin esa variable:** escucha en `127.0.0.1` (no en `0.0.0.0`) y monta Swagger en `/docs`. Swagger es una herramienta de desarrollo; CloudFront no enruta `/docs`.

`addCookieAuth` documenta que la sesión viaja en cookie, no en `Authorization`.

### 8.3 Lambda HTTP

```ts
// src/lambda.ts
import type { Context } from 'aws-lambda';
import type { HttpHandler } from './lambda-bootstrap';

let cached: Promise<HttpHandler> | undefined;

function bootFailure(error: unknown) {
  console.error(
    JSON.stringify({
      level: 'fatal',
      msg: 'Lambda bootstrap failed',
      err: error instanceof Error ? error.stack : String(error),
    }),
  );
  return {
    statusCode: 503,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify({
      statusCode: 503,
      message: 'La API no está disponible. Intenta de nuevo.',
    }),
  };
}

/**
 * Handler HTTP. Solo async (Node 24 no admite callbacks).
 * Los import() dinámicos mantienen fuera del camino caliente todo lo que no
 * hace falta hasta el primer request, y permiten devolver un 503 controlado
 * si el arranque falla (secreto ausente, entorno inválido).
 */
export const handler = async (event: unknown, context: Context) => {
  try {
    cached ??= (async () => {
      const { hydrateSecrets } = await import('./config/hydrate-secrets');
      await hydrateSecrets();
      const { bootstrapLambda } = await import('./lambda-bootstrap');
      return bootstrapLambda();
    })();
    const server = await cached;
    return await server(event, context);
  } catch (error) {
    // No cachear un arranque fallido: el siguiente request lo reintenta.
    cached = undefined;
    return bootFailure(error);
  }
};
```

```ts
// src/lambda-bootstrap.ts
import 'reflect-metadata';
import serverlessExpress from '@codegenie/serverless-express';
import { NestFactory } from '@nestjs/core';
import type { Context } from 'aws-lambda';
import type { RequestListener } from 'node:http';
import { AppModule } from './app.module';
import { initSentry } from './common/observability/sentry';
import { configureApp } from './configure-app';

export type HttpHandler = (event: unknown, context: Context) => Promise<unknown>;

export async function bootstrapLambda(): Promise<HttpHandler> {
  await initSentry({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.STAGE ?? 'unknown',
    release: process.env.RELEASE,
  });
  const app = await NestFactory.create(AppModule, { bufferLogs: true, abortOnError: false });
  configureApp(app);
  await app.init();
  // v5 solo resuelve por promesa; el tipo `Handler` de aws-lambda aún declara el callback.
  return serverlessExpress({
    app: app.getHttpAdapter().getInstance() as RequestListener,
  }) as unknown as HttpHandler;
}
```

Node 24 en Lambda **no invoca** handlers de callback. El export es `async`. El contrato de `@codegenie/serverless-express` v5 es una función `(event, context) => Promise<APIGatewayProxyResultV2>` (el paquete `@vendia/serverless-express` quedó sin mantenimiento; este es su sucesor).

La promesa de arranque se cachea entre invocaciones calientes. Si el arranque **falla**, la promesa se descarta: un cold start que no pudo leer Secrets Manager no se queda envenenado hasta que Lambda mate el entorno. La respuesta de ese fallo es 503 con cuerpo JSON genérico; el detalle va al log, no al cliente.

El humo medido sobre este bundle (07/10/2026, PostgreSQL local, stage simulado `dev`): carga del módulo 164 ms, primera invocación 411 ms, segunda 2.1 ms.

### 8.4 `app.module.ts`

```ts
// src/app.module.ts
import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { RolesGuard } from './common/auth/roles.guard';
import { EdgeGuardsMiddleware } from './common/http/edge-guards.middleware';
import { loggerParams } from './common/observability/logger.config';
import { buildDataSourceOptions } from './config/database.config';
import { type EnvConfig, validateEnv } from './config/env.validation';
import { ENTITIES } from './database/entities';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { HealthController } from './modules/health/health.controller';
import { ProjectsModule } from './modules/projects/projects.module';
import { UsersModule } from './modules/users/users.module';
// + aquí se añaden los módulos del dominio nuevo

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      // En Lambda no hay .env; en tests el entorno lo fija el propio test.
      ignoreEnvFile:
        Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) || process.env.NODE_ENV === 'test',
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) =>
        loggerParams({
          level: config.get('LOG_LEVEL', { infer: true }),
          stage: config.get('STAGE', { infer: true }),
          // pino-pretty usa un worker thread: solo en desarrollo local, nunca dentro de un bundle.
          pretty:
            config.get('STAGE', { infer: true }) === 'local' &&
            !process.env.AWS_LAMBDA_FUNCTION_NAME,
        }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => ({
        ...buildDataSourceOptions({
          DB_HOST: config.get('DB_HOST', { infer: true }),
          DB_PORT: config.get('DB_PORT', { infer: true }),
          DB_USERNAME: config.get('DB_USERNAME', { infer: true }),
          DB_PASSWORD: config.get('DB_PASSWORD', { infer: true }),
          DB_NAME: config.get('DB_NAME', { infer: true }),
          DB_IAM_AUTH: config.get('DB_IAM_AUTH', { infer: true }),
          DB_SSL: config.get('DB_SSL', { infer: true }),
          DB_POOL_MAX: config.get('DB_POOL_MAX', { infer: true }),
          AWS_REGION: config.get('AWS_REGION', { infer: true }),
          STAGE: config.get('STAGE', { infer: true }),
        }),
        entities: ENTITIES,
      }),
    }),
    AuditModule,
    UsersModule,
    AuthModule,
    ProjectsModule,
    DocumentsModule,
  ],
  controllers: [HealthController],
  providers: [
    // El orden de los APP_GUARD es el orden de ejecución.
    // 1. Autenticación: todas las rutas salvo @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // 2. Autorización por grupo de Cognito: solo actúa si hay @Roles(...).
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(EdgeGuardsMiddleware).forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
```

`JwtAuthGuard` y `RolesGuard` son globales. Toda ruta nueva nace autenticada y, si declara roles, autorizada. Hacerla pública es una decisión explícita: `@Public()`.

`ignoreEnvFile` en Lambda y en tests. En Lambda un `.env` dentro del zip sería un secreto empaquetado; en tests el entorno lo fija `test/support/test-app.ts` y un `.env` del desarrollador no debe colarse.

El módulo `ProjectsModule` es el ejemplo de la sección 12. El dominio nuevo añade sus módulos en el import marcado.

### 8.5 Salud

```ts
// src/modules/health/health.controller.ts
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { Public } from '../../common/auth/roles';
import type { EnvConfig } from '../../config/env.validation';

@ApiTags('Salud')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Liveness + readiness: la app arrancó y la base responde' })
  async check() {
    const started = Date.now();
    try {
      await this.db.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException('La base de datos no responde.');
    }
    return {
      status: 'ok',
      stage: this.config.get('STAGE', { infer: true }),
      release: this.config.get('RELEASE', { infer: true }) ?? 'local',
      dbLatencyMs: Date.now() - started,
    };
  }
}
```

`GET /api/health` es `@Public()` y ejecuta `SELECT 1`. Un 200 sin tocar la base solo dice que el proceso arrancó; el balanceador y el smoke de CI necesitan saber que el camino hasta PostgreSQL está vivo. El cuerpo incluye `stage` y `release` (el SHA que inyecta el pipeline) para saber qué versión contestó.

CloudFront no debe cachear esta ruta: el behavior de `/api/*` reenvía todo y la API manda `Cache-Control: no-store`.

---
## 9. Cross-cutting (`src/common/`)

🆕 **V2.** Nada de esta carpeta importa `src/modules/`.

### 9.1 Roles, usuario actual y guards

```ts
// src/common/auth/roles.ts
import { SetMetadata } from '@nestjs/common';

export const ROLES = ['<ROL_A>', '<ROL_B>'] as const;
export type Role = (typeof ROLES)[number];
export const ADMIN_ROLE: Role = '<ROL_B>';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const IS_PUBLIC_KEY = 'isPublic';
/** Ruta accesible sin sesión. Solo tiene efecto porque JwtAuthGuard es global. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

```ts
// src/common/auth/current-user.ts
import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';

/** Lo que JwtStrategy.validate() deja en request.user (claims del access token). */
export interface AccessTokenClaims {
  sub: string;
  username: string;
  'cognito:groups'?: string[];
  token_use: 'access';
  client_id: string;
  exp: number;
  iat: number;
}

export interface CurrentUserPayload {
  sub: string;
  username: string;
  groups: string[];
  /** Expiración del access token, en segundos epoch. */
  exp: number;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    const user = ctx.switchToHttp().getRequest<{ user?: AccessTokenClaims }>().user;
    if (!user) {
      // Solo ocurre si se usa @CurrentUser() en una ruta @Public(): es un bug del controlador.
      throw new UnauthorizedException('No hay una sesión activa.');
    }
    return {
      sub: user.sub,
      username: user.username,
      groups: user['cognito:groups'] ?? [],
      exp: user.exp,
    };
  },
);
```

```ts
// src/common/auth/jwt-auth.guard.ts
import {
  ExecutionContext,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from './roles';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  override handleRequest<TUser>(err: unknown, user: TUser, info: unknown): TUser {
    if (!err && user) return user;
    if (err instanceof HttpException) throw err;
    if (err) {
      // Fallo de infraestructura (p. ej. la BD no responde al leer userStatus):
      // no se concede acceso, pero tampoco se responde 401, que haría que el
      // frontend cerrara la sesión de todos los usuarios durante una caída.
      throw new ServiceUnavailableException('Servicio no disponible temporalmente.');
    }
    const name = (info as { name?: string; message?: string } | undefined)?.name;
    const message = (info as { message?: string } | undefined)?.message;
    if (message === 'No auth token') {
      throw new UnauthorizedException('No hay una sesión activa.');
    }
    if (name === 'TokenExpiredError') {
      throw new UnauthorizedException('La sesión expiró.');
    }
    throw new UnauthorizedException('La sesión no es válida.');
  }
}
```

```ts
// src/common/auth/roles.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AccessTokenClaims } from './current-user';
import { ROLES_KEY, type Role } from './roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<{ user?: AccessTokenClaims }>().user;
    const groups = user?.['cognito:groups'] ?? [];
    if (required.some((role) => groups.includes(role))) return true;

    throw new ForbiddenException('No tienes permisos para realizar esta acción.');
  }
}
```

`ROLES` tiene dos entradas: `<ROL_A>` (operación) y `<ROL_B>` (administración, propuesto `Admin`). Un usuario puede tener varios grupos de Cognito; el guard deja pasar si **alguno** coincide con los roles exigidos. Sin `@Roles(...)` la ruta solo exige sesión.

El guard JWT distingue tres fallos y no los mezcla:

| Situación | HTTP | Por qué |
|---|---|---|
| No hay cookie, firma inválida, `iss`/`client_id`/`token_use` no coinciden, usuario no existe | 401 | La sesión no es válida. El frontend intenta un refresh y, si no, manda a login |
| El usuario existe pero su estado no es `active` | 403 | La sesión es real; no se refresca. Hay que decir por qué |
| La base de datos no responde (timeout, proxy caído) | 503 | Falla **cerrado**, pero no es un 401: un corte de base no debe cerrar la sesión de todos los usuarios conectados |

Cualquier `HttpException` que lance la estrategia se reenvía tal cual. Cualquier otra excepción se convierte en 503. Tragarla y responder 401 era el comportamiento de la v1, y un error de TypeORM se veía como "token caducado".

### 9.2 Petición: id, IP, origen, CSRF

```ts
// src/common/http/request-id.ts
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';
const VALID_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Reutiliza el x-request-id que manda el frontend (o un sistema upstream) si
 * tiene una forma segura; si no, genera uno. Siempre lo devuelve en la
 * respuesta para que el usuario pueda citarlo al reportar un error.
 */
export function genRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  const id = candidate && VALID_ID.test(candidate) ? candidate : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

export function requestIdOf(req: { id?: unknown }): string {
  return typeof req.id === 'string' ? req.id : 'unknown';
}
```

```ts
// src/common/http/request-context.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { clientIp } from './client-ip';
import { requestIdOf } from './request-id';

export interface RequestContext {
  ip: string;
  requestId: string;
  userAgent: string | null;
}

/** IP real, requestId y user-agent de la petición, para auditoría y consentimiento. */
export const ReqCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext => {
    const req = ctx.switchToHttp().getRequest<Request & { id?: unknown }>();
    const ua = req.headers['user-agent'];
    return {
      ip: clientIp(req),
      requestId: requestIdOf(req),
      userAgent: typeof ua === 'string' ? ua.slice(0, 256) : null,
    };
  },
);
```

```ts
// src/common/http/client-ip.ts
import type { Request } from 'express';

/**
 * IP real del cliente. Detrás de CloudFront → API Gateway, `req.ip` es la IP
 * de CloudFront; la del usuario llega en `CloudFront-Viewer-Address`
 * ("203.0.113.7:51234" o "[2001:db8::1]:51234"), que la política de origen
 * de CloudFront reenvía (16.6). En local se usa `req.ip`.
 */
export function clientIp(req: Request): string {
  const viewer = req.headers['cloudfront-viewer-address'];
  const raw = Array.isArray(viewer) ? viewer[0] : viewer;
  if (raw) {
    const lastColon = raw.lastIndexOf(':');
    const host = lastColon > 0 ? raw.slice(0, lastColon) : raw;
    return host.replace(/^\[|\]$/g, '');
  }
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}
```

```ts
// src/common/http/client-ip.spec.ts
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { clientIp } from './client-ip';

const req = (headers: Record<string, string>, ip = '10.0.0.1') =>
  ({ headers, ip }) as unknown as Request;

describe('clientIp', () => {
  it('usa CloudFront-Viewer-Address (IPv4)', () => {
    expect(clientIp(req({ 'cloudfront-viewer-address': '203.0.113.7:51234' }))).toBe('203.0.113.7');
  });
  it('usa CloudFront-Viewer-Address (IPv6)', () => {
    expect(clientIp(req({ 'cloudfront-viewer-address': '[2001:db8::1]:443' }))).toBe('2001:db8::1');
  });
  it('sin CloudFront cae a req.ip', () => {
    expect(clientIp(req({}))).toBe('10.0.0.1');
  });
});
```

```ts
// src/common/http/edge-guards.middleware.ts
import { timingSafeEqual } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import type { EnvConfig } from '../../config/env.validation';
import { requestIdOf } from './request-id';

export const ORIGIN_VERIFY_HEADER = 'x-origin-verify';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Dos filtros que van antes que cualquier controlador. Son middleware de Nest
 * (no `app.use`) para ejecutarse DESPUÉS de pino-http: así cada rechazo queda
 * registrado con su requestId.
 *
 * 1. Origen: la URL de API Gateway es pública. CloudFront añade una cabecera
 *    secreta; quien no la trae se está saltando WAF y recibe 403. Sin secreto
 *    configurado (local) no filtra.
 * 2. CSRF (defensa en profundidad sobre SameSite=Strict): toda mutación debe
 *    venir del propio origen. Los navegadores modernos envían Sec-Fetch-Site;
 *    los antiguos, Origin. Un cliente sin ninguna de las dos no es un navegador
 *    y por tanto no puede portar la cookie de una víctima.
 */
@Injectable()
export class EdgeGuardsMiddleware implements NestMiddleware {
  private readonly secret?: Buffer;
  private readonly appOrigin: string;

  constructor(config: ConfigService<EnvConfig, true>) {
    const secret = config.get('ORIGIN_VERIFY_SECRET', { infer: true });
    this.secret = secret ? Buffer.from(secret) : undefined;
    this.appOrigin = new URL(config.get('APP_ORIGIN', { infer: true })).origin;
  }

  use(req: Request, res: Response, next: NextFunction): void {
    if (this.secret && !this.hasOriginSecret(req)) {
      return this.reject(req, res, 'Forbidden');
    }
    if (!SAFE_METHODS.has(req.method) && !this.isSameOrigin(req)) {
      return this.reject(req, res, 'Origen de la petición no permitido');
    }
    next();
  }

  private hasOriginSecret(req: Request): boolean {
    const got = req.headers[ORIGIN_VERIFY_HEADER];
    const value = Buffer.from(typeof got === 'string' ? got : '');
    return value.length === this.secret!.length && timingSafeEqual(value, this.secret!);
  }

  private isSameOrigin(req: Request): boolean {
    const site = req.headers['sec-fetch-site'];
    if (typeof site === 'string') return site === 'same-origin';
    const origin = req.headers.origin;
    if (typeof origin === 'string') return origin === this.appOrigin;
    return true;
  }

  private reject(req: Request, res: Response, message: string): void {
    res.status(403).json({
      statusCode: 403,
      message,
      requestId: requestIdOf(req as Request & { id?: unknown }),
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
    });
  }
}
```

`x-request-id` se reutiliza solo si es un UUID. Cualquier otro valor (un cliente puede mandar lo que quiera) se descarta y se genera uno. El mismo id sale en la cabecera de respuesta, en el log de pino, en el cuerpo de error y en la fila de `audit_logs`.

La IP se toma de `CloudFront-Viewer-Address` (`1.2.3.4:12345` → `1.2.3.4`). Es una cabecera que CloudFront inyecta y que el behavior de `/api/*` reenvía. No se usa `X-Forwarded-For`. En local, sin esa cabecera, se usa `req.ip`.

`EdgeGuardsMiddleware` hace dos comprobaciones, en este orden, sobre **todos** los métodos:

1. **Origen.** En `dev`/`qa`/`prod` la cabecera `x-origin-verify` tiene que coincidir con el secreto. La pone CloudFront y el cliente no la puede añadir (el behavior no reenvía una `x-origin-verify` que venga del navegador: la sobrescribe). Sin ella, 403. En `local` y `test` no se exige.
2. **CSRF, solo en métodos no seguros.** Pasa si `Sec-Fetch-Site` es `same-origin` o `none` (el segundo cubre curl y las pruebas), o si `Origin` es exactamente `APP_ORIGIN`. Una petición cross-site de un formulario no manda `Sec-Fetch-Site: same-origin`. Las cookies `SameSite=Strict` ya bloquean ese caso en navegadores actuales; esta comprobación cubre el resto y no depende de que el navegador implemente SameSite.

El middleware es de Nest, no `app.use`, para que pino haya corrido antes y el 403 lleve `requestId`.

### 9.3 Logs y Sentry

```ts
// src/common/observability/logger.config.ts
import type { Params } from 'nestjs-pino';
import { genRequestId } from '../http/request-id';

const REDACT = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-origin-verify"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.newPassword',
  '*.refreshToken',
  '*.accessToken',
  '*.code',
];

export function loggerParams(opts: { level: string; stage: string; pretty: boolean }): Params {
  return {
    pinoHttp: {
      level: opts.level,
      genReqId: genRequestId,
      redact: { paths: REDACT, censor: '[REDACTED]' },
      base: { stage: opts.stage, fn: process.env.AWS_LAMBDA_FUNCTION_NAME },
      customProps: (req) => {
        const user = (req as { user?: { sub?: string } }).user;
        return user?.sub ? { userSub: user.sub } : {};
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      ...(opts.pretty
        ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
        : {}),
    },
  };
}
```

```ts
// src/common/observability/sentry.ts
import type * as SentryNode from '@sentry/node';

let sentry: typeof SentryNode | undefined;

/**
 * Inicialización mínima de Sentry: solo captura explícita de errores, sin
 * trazas, sin integraciones automáticas y sin hooks de carga de módulos
 * (encarecen el arranque en frío). Las trazas de rendimiento las da X-Ray (24.4).
 */
export async function initSentry(opts: {
  dsn?: string;
  environment: string;
  release?: string;
}): Promise<void> {
  if (!opts.dsn || sentry) return;
  const mod = await import('@sentry/node');
  mod.init({
    dsn: opts.dsn,
    environment: opts.environment,
    release: opts.release,
    tracesSampleRate: 0,
    enableOpenTelemetrySetup: false,
    enableRuntimeChannelInjection: false,
    defaultIntegrations: false,
  });
  sentry = mod;
}

export function captureException(error: unknown, context: Record<string, unknown>): void {
  sentry?.captureException(error, { extra: context });
}

/** En Lambda el proceso se congela al responder: hay que vaciar la cola antes. */
export async function flushSentry(timeoutMs = 1500): Promise<void> {
  await sentry?.flush(timeoutMs);
}
```

Pino redacta `req.headers.cookie`, `authorization`, `x-origin-verify`, `res.headers['set-cookie']` y cualquier campo `password`/`refreshToken`/`clientSecret` del body. El body no se loguea entero: solo la lista de claves.

`/api/health` no entra en el auto-logging. Un balanceador que pega cada 10 segundos llenaría el grupo de logs y la factura.

Sentry (`@sentry/node` 11) se inicializa solo si hay `SENTRY_DSN`. Tres opciones que en la versión 11 cambiaron de nombre y, si se escriben las antiguas, el proceso no arranca o instrumenta OpenTelemetry dos veces:

- `enableOpenTelemetrySetup: false` y `enableRuntimeChannelInjection: false`. El tracing lo hace X-Ray (24.2), no el SDK de Sentry. Las dos a la vez duplican spans y se pisan.
- `defaultIntegrations: false`. Las integraciones por defecto enganchan `console` y el loader de módulos; en un bundle de Lambda eso añade peso y ruido. Los errores se capturan a mano en el filtro, solo los 5xx.
- `tracesSampleRate: 0`. Sin esto el SDK abre un transporte de tracing que no vamos a usar.
- `sendDefaultPii: false` ya no existe en la versión 11; no añadirla.

`Sentry.flush(2000)` después de capturar, porque Lambda puede congelar el proceso antes de que el cliente termine de enviar.

### 9.4 Filtro de excepciones

```ts
// src/common/filters/http-exception.filter.ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { requestIdOf } from '../http/request-id';
import { captureException, flushSentry } from '../observability/sentry';

export interface ErrorBody {
  statusCode: number;
  message: string | string[];
  requestId: string;
  timestamp: string;
  path: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = requestIdOf(req as Request & { id?: unknown });

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Ocurrió un error inesperado en el servidor.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object' && 'message' in body) {
        message = (body as { message: string | string[] }).message;
      }
    }

    if (status >= 500) {
      this.logger.error(
        { err: exception, requestId, path: req.originalUrl },
        'Error no controlado',
      );
      captureException(exception, { requestId, path: req.originalUrl });
      await flushSentry();
    }

    const payload: ErrorBody = {
      statusCode: status,
      message,
      requestId,
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
    };
    res.status(status).json(payload);
  }
}
```

El cuerpo de error es siempre el mismo:

```json
{ "statusCode": 400, "message": "…", "requestId": "…", "timestamp": "…", "path": "/api/…" }
```

`message` es el mensaje de la excepción si es un string, o el array de class-validator unido. Nunca es el stack, nunca es un error de Postgres con el SQL. El stack va al log, con el `requestId`.

Sentry solo recibe 5xx. Un 400 de validación no es un incidente.

El tipo de `status` se trata como `number` al compararlo: el enum `HttpStatus` de Nest y un `number` suelto disparan `@typescript-eslint/no-unsafe-enum-comparison` si se comparan directo.

### 9.5 Paginación, decimales, errores de Postgres, auditoría

```ts
// src/common/pagination/page.ts
import { applyDecorators, type Type as ClassType } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Parámetros de paginación comunes. Los query params llegan como string: @Type los convierte. */
export class PageQueryDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}

/** Forma única de toda respuesta paginada de la API. */
export class PageDto<T> {
  @ApiProperty({ isArray: true })
  items: T[];

  @ApiProperty({ description: 'Total de filas que cumplen el filtro (sin paginar)' })
  total: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  offset: number;
}

export function toPage<T>(items: T[], total: number, q: PageQueryDto): PageDto<T> {
  return { items, total, limit: q.limit, offset: q.offset };
}

/**
 * Documenta en OpenAPI una respuesta PageDto<Model> con el tipo concreto de `items`.
 * Sin esto, el cliente generado en el frontend vería `items: unknown[]`.
 */
export function ApiPageResponse(model: ClassType<unknown>) {
  return applyDecorators(
    ApiExtraModels(PageDto, model),
    ApiOkResponse({
      schema: {
        allOf: [
          { $ref: getSchemaPath(PageDto) },
          { properties: { items: { type: 'array', items: { $ref: getSchemaPath(model) } } } },
        ],
      },
    }),
  );
}
```

```ts
// src/common/utils/decimal.util.ts
import Decimal from 'decimal.js';

export function toDecimal(value: number | string | null | undefined): Decimal | null {
  if (value === null || value === undefined || value === '') return null;
  return new Decimal(value);
}

export function safeDivide(numerator: Decimal | null, denominator: Decimal | null): Decimal | null {
  if (!numerator || !denominator || denominator.isZero()) return null;
  return numerator.div(denominator);
}

export function decimalToNumber(value: Decimal | null): number | null {
  return value ? value.toNumber() : null;
}

export function parseAmount(text: string): Decimal | null {
  const cleaned = text.replace(/[^\d.,()-]/g, '').trim();
  if (!cleaned) return null;
  const negative = cleaned.startsWith('(') && cleaned.endsWith(')');
  const normalized = cleaned.replace(/[()]/g, '').replace(/,/g, '');
  const num = toDecimal(normalized);
  if (!num) return null;
  return negative ? num.neg() : num;
}
```

```ts
// src/common/database/pg-errors.ts
import { QueryFailedError } from 'typeorm';

/** Código SQLSTATE de PostgreSQL para violación de restricción única. */
export const PG_UNIQUE_VIOLATION = '23505';

/**
 * true si el error es una violación de unicidad (opcionalmente de una restricción concreta).
 * Detectar el conflicto al insertar, en vez de consultar antes, elimina la carrera entre
 * dos peticiones simultáneas: la base es la única que puede garantizar la unicidad.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as { code?: string; constraint?: string };
  return (
    driverError.code === PG_UNIQUE_VIOLATION &&
    (!constraint || driverError.constraint === constraint)
  );
}
```

```ts
// src/common/constants/audit-actions.ts
export const AUDIT_ACTIONS = {
  USER_LOGIN: 'USER_LOGIN',
  USER_LOGIN_FAILED: 'USER_LOGIN_FAILED',
  USER_MFA_ENROLLED: 'USER_MFA_ENROLLED',
  USER_SIGNUP: 'USER_SIGNUP',
  USER_CONFIRM_SIGNUP: 'USER_CONFIRM_SIGNUP',
  USER_FORGOT_PASSWORD: 'USER_FORGOT_PASSWORD',
  USER_CONFIRM_PASSWORD: 'USER_CONFIRM_PASSWORD',
  USER_LOGOUT: 'USER_LOGOUT',
  USER_LOGOUT_ALL: 'USER_LOGOUT_ALL',
  ADMIN_UPDATE_USER_STATUS: 'ADMIN_UPDATE_USER_STATUS',
  GENERATE_PRESIGNED_URL: 'GENERATE_PRESIGNED_URL',
  DOWNLOAD_DOCUMENT: 'DOWNLOAD_DOCUMENT',
  // Acciones del dominio (🟦 ejemplo: módulo projects de 12.2)
  PROJECT_CREATED: 'PROJECT_CREATED',
  PROJECT_UPDATED: 'PROJECT_UPDATED',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
```

`PageQueryDto` limita `limit` a 100. `toPage` calcula `pageCount` sin devolver de más. `ApiPageResponse` es el decorador de Swagger para que el OpenAPI describa la envoltura `{ data, meta }`.

`decimal.js` es la única forma de operar importes. La columna es `numeric`, el driver entrega `string`, y un `Number("0.10") + Number("0.20")` no es `0.30`.

`isUniqueViolation` reconoce el código `23505`. Los servicios lo traducen a 409. No se captura con `error.message.includes('duplicate')`: el texto cambia con el idioma del servidor.

Las acciones de auditoría son constantes. Una cadena libre en cada servicio produce diez grafías del mismo hecho y los informes dejan de cuadrar.

---
## 10. Autenticación y RBAC con Cognito, end to end

🆕 **V2.** Cognito es el proveedor de identidad. El backend no firma JWTs propios y no guarda contraseñas. La sesión que ve el navegador son tres cookies que el backend emite y que JavaScript no puede leer.

### 10.1 Las tres cookies

| Cookie (HTTPS) | Cookie (HTTP local) | Path | Vida | Contenido |
|---|---|---|---|---|
| `__Host-<app-short>_at` | `<app-short>_at` | `/` | la de `ExpiresIn` de Cognito (15 min) | Access token |
| `__Secure-<app-short>_rt` | `<app-short>_rt` | `/api/auth` | 30 días | Refresh token |
| `__Secure-<app-short>_mfa` | `<app-short>_mfa` | `/api/auth` | 5 min | Estado opaco del reto en curso |

`httpOnly`, `Secure` (solo con HTTPS), `SameSite=Strict`. Sin atributo `Domain`: el prefijo `__Host-` lo prohíbe, y así un subdominio comprometido no puede plantar una cookie de sesión. En local el navegador rechaza los prefijos `__Host-`/`__Secure-` sobre HTTP, por eso se omiten. La función que elige los nombres es la única fuente; los tests y el frontend no los hardcodean, los descubren por el comportamiento (el frontend ni siquiera los lee: `httpOnly`).

El refresh token solo viaja a `/api/auth/*`. Un XSS en una página que llama a `/api/projects` no lo arrastra.

### 10.2 Recorrido

```
POST /api/auth/login          { email, password }
        │
        ├─ tokens ──────────► Set-Cookie access + refresh, limpia el reto
        │                     body: { status: "authenticated" }
        │
        └─ reto ────────────► Set-Cookie reto (base64url de {c,s,u,e})
                              body: { status: "challenge", challenge: "SOFTWARE_TOKEN_MFA"
                                      | "MFA_SETUP" | "NEW_PASSWORD_REQUIRED" | "EMAIL_OTP" }

POST /api/auth/challenge      { code } o { newPassword }
POST /api/auth/challenge/mfa-setup   { code }   (verifica el TOTP recién asociado)
        │
        └─ el servicio reenvía a Cognito con la session del reto y el SECRET_HASH
           firmado con el USERNAME interno (USER_ID_FOR_SRP), no con el email

POST /api/auth/refresh        (sin body: la cookie de refresh va sola por el path)
POST /api/auth/logout         RevokeToken del refresh, aunque el access haya caducado
POST /api/auth/logout-all     GlobalSignOut
GET  /api/auth/me             perfil desde la tabla users, no desde los claims del ID token
```

Alta, confirmación y recuperación siguen siendo de Cognito y son públicas:

`POST /api/auth/signup`, `/confirm`, `/resend-code`, `/forgot-password`, `/confirm-password`, y `GET /api/auth/terms-link`.

`signup` solo existe si `AUTH_SELF_SIGNUP=true` (el user pool lo permite; ver Anexo A). Si el alta crea el usuario en Cognito y falla al insertar la fila local, se llama a `AdminDeleteUser` con el **sub** devuelto, no con el email: borrar por email puede borrar a otra persona si el email se reutilizó.

### 10.3 Qué se valida del access token

`jwt.strategy.ts` comprueba, además de la firma RS256 contra el JWKS del pool:

- `token_use === "access"`. Un ID token presentado como sesión se rechaza.
- `client_id === COGNITO_CLIENT_ID`. Un token emitido para otra app del mismo pool no sirve.
- `iss` es el issuer del pool.

Después carga el usuario de la tabla `users` por el `sub`. El perfil (email, nombre, estado, roles) sale de esa fila. Los claims del token no se proyectan al cliente: Cognito y la base pueden divergir un instante tras un cambio de grupo, y la fuente de autorización de la API es la fila local que el migrator y `AdminAddUserToGroup` mantienen alineada con los grupos.

Usuario desconocido → 401. Error de base → 503 (9.1).

### 10.4 `SECRET_HASH` y la rotación del refresh

El app client de Cognito tiene secreto. Estas llamadas llevan `SECRET_HASH = HMAC_SHA256(clientSecret, username + clientId)`:

- `InitiateAuth` con `USER_PASSWORD_AUTH`
- `RespondToAuthChallenge`
- `SignUp`, `ConfirmSignUp`, `ForgotPassword`, `ConfirmForgotPassword`, `ResendConfirmationCode`

El `username` de ese HMAC, en los retos, es el `USERNAME` interno que Cognito devuelve (`USER_ID_FOR_SRP`), no el email con el que el usuario escribió. El estado del reto lo guarda en la cookie (`u`). Perderlo a mitad de un reto encadenado (por ejemplo MFA después de `NEW_PASSWORD_REQUIRED`) produce un `NotAuthorizedException` que parece una contraseña mala.

**El refresh no usa ese HMAC.** Con el plan Essentials, la rotación se hace con `GetTokensFromRefreshToken` y el secreto va en el campo `ClientSecret` de la petición, no en `SECRET_HASH`. Cada refresh invalida el refresh token anterior. `RetryGracePeriodSeconds: 10` (16.5) absorbe el reintento de dos pestañas que refrescan a la vez; fuera de esa ventana el segundo recibe 401 y el usuario vuelve a login. Es el comportamiento que se quiere.

### 10.5 Código

```ts
// src/modules/auth/session-cookies.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import type { EnvConfig } from '../../config/env.validation';

const APP = '<app-short>';
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const AUTH_PATH = '/api/auth';

/** Estado de un login a medio camino (MFA, cambio de contraseña). Opaco para el navegador. */
export interface ChallengeState {
  /** Nombre del reto de Cognito pendiente. */
  c: string;
  /** Session de Cognito (opaca, caduca en 3 minutos). */
  s: string;
  /** USERNAME interno de Cognito (USER_ID_FOR_SRP); con él se firma SECRET_HASH. */
  u: string;
  /** Email con el que se inició sesión (para la URI otpauth y la auditoría). */
  e: string;
}

/**
 * Nombres de cookie según el origen. Con HTTPS se usan los prefijos
 * `__Host-` (obliga a Secure, Path=/ y sin Domain: no se puede inyectar desde
 * un subdominio) y `__Secure-`. En HTTP local los navegadores rechazan esos
 * prefijos, así que se omiten.
 */
export function sessionCookieNames(appOrigin: string) {
  const secure = appOrigin.startsWith('https://');
  return {
    secure,
    access: secure ? `__Host-${APP}_at` : `${APP}_at`,
    refresh: secure ? `__Secure-${APP}_rt` : `${APP}_rt`,
    challenge: secure ? `__Secure-${APP}_mfa` : `${APP}_mfa`,
  };
}

@Injectable()
export class SessionCookies {
  readonly names: ReturnType<typeof sessionCookieNames>;

  constructor(config: ConfigService<EnvConfig, true>) {
    this.names = sessionCookieNames(config.get('APP_ORIGIN', { infer: true }));
  }

  private base(path: string): CookieOptions {
    return { httpOnly: true, secure: this.names.secure, sameSite: 'strict', path };
  }

  setSession(
    res: Response,
    tokens: { accessToken: string; refreshToken?: string; expiresIn: number },
  ): void {
    res.cookie(this.names.access, tokens.accessToken, {
      ...this.base('/'),
      maxAge: tokens.expiresIn * 1000,
    });
    if (tokens.refreshToken) {
      res.cookie(this.names.refresh, tokens.refreshToken, {
        ...this.base(AUTH_PATH),
        maxAge: REFRESH_TTL_MS,
      });
    }
    res.clearCookie(this.names.challenge, this.base(AUTH_PATH));
  }

  setChallenge(res: Response, state: ChallengeState): void {
    const value = Buffer.from(JSON.stringify(state)).toString('base64url');
    res.cookie(this.names.challenge, value, { ...this.base(AUTH_PATH), maxAge: CHALLENGE_TTL_MS });
  }

  clearAll(res: Response): void {
    res.clearCookie(this.names.access, this.base('/'));
    res.clearCookie(this.names.refresh, this.base(AUTH_PATH));
    res.clearCookie(this.names.challenge, this.base(AUTH_PATH));
  }

  accessToken(req: Request): string | undefined {
    return readCookie(req, this.names.access);
  }

  refreshToken(req: Request): string | undefined {
    return readCookie(req, this.names.refresh);
  }

  challenge(req: Request): ChallengeState | undefined {
    const raw = readCookie(req, this.names.challenge);
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as ChallengeState;
      return parsed.c && parsed.s && parsed.u ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
}

function readCookie(req: Request, name: string): string | undefined {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
```

```ts
// src/modules/auth/cognito.provider.ts
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '../../config/env.validation';

/** Token de inyección: los tests lo sustituyen por un doble con `send` simulado (15.3). */
export const COGNITO_CLIENT = Symbol('COGNITO_CLIENT');

export type CognitoClient = Pick<CognitoIdentityProviderClient, 'send'>;

export const cognitoClientProvider: Provider = {
  provide: COGNITO_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService<EnvConfig, true>): CognitoClient =>
    new CognitoIdentityProviderClient({ region: config.get('AWS_REGION', { infer: true }) }),
};
```

```ts
// src/modules/auth/jwt-key.provider.ts
import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { passportJwtSecret } from 'jwks-rsa';
import type { SecretOrKeyProvider } from 'passport-jwt';
import type { EnvConfig } from '../../config/env.validation';

/** Token de inyección de las claves públicas de firma. Los tests lo sustituyen por una clave local (15.3). */
export const JWT_KEY_PROVIDER = Symbol('JWT_KEY_PROVIDER');

export function cognitoIssuer(config: ConfigService<EnvConfig, true>): string {
  return `https://cognito-idp.${config.get('AWS_REGION', { infer: true })}.amazonaws.com/${config.get('COGNITO_USER_POOL_ID', { infer: true })}`;
}

export const jwtKeyProvider: Provider = {
  provide: JWT_KEY_PROVIDER,
  inject: [ConfigService],
  useFactory: (config: ConfigService<EnvConfig, true>): SecretOrKeyProvider =>
    passportJwtSecret({
      cache: true,
      cacheMaxAge: 6 * 60 * 60 * 1000,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
      jwksUri: `${cognitoIssuer(config)}/.well-known/jwks.json`,
    }) as SecretOrKeyProvider,
};
```

```ts
// src/modules/auth/jwt.strategy.ts
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { Strategy, type SecretOrKeyProvider } from 'passport-jwt';
import type { AccessTokenClaims } from '../../common/auth/current-user';
import type { EnvConfig } from '../../config/env.validation';
import { USER_STATUS } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { cognitoIssuer, JWT_KEY_PROVIDER } from './jwt-key.provider';
import { sessionCookieNames } from './session-cookies';

const BLOCKED_MESSAGES: Record<string, string> = {
  [USER_STATUS.BLOCKED]: 'Tu cuenta fue bloqueada. Comunícate con soporte.',
  [USER_STATUS.REJECTED]: 'Tu cuenta fue rechazada.',
  [USER_STATUS.OBSERVED]: 'Tu cuenta está en revisión. El acceso está suspendido temporalmente.',
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly clientId: string;

  constructor(
    config: ConfigService<EnvConfig, true>,
    private readonly users: UsersService,
    @Inject(JWT_KEY_PROVIDER) keyProvider: SecretOrKeyProvider,
  ) {
    const issuer = cognitoIssuer(config);
    const cookieName = sessionCookieNames(config.get('APP_ORIGIN', { infer: true })).access;

    super({
      jwtFromRequest: (req: Request) =>
        (req.cookies as Record<string, string> | undefined)?.[cookieName] ?? null,
      ignoreExpiration: false,
      // Sin esta lista, un token HS256 firmado con la clave pública pasaría (confusión de algoritmo).
      algorithms: ['RS256'],
      issuer,
      secretOrKeyProvider: keyProvider,
    });
    this.clientId = config.get('COGNITO_CLIENT_ID', { infer: true });
  }

  /**
   * La firma, la expiración y el emisor ya están verificados. Aquí se exige que
   * sea un ACCESS token de NUESTRO App Client, y se aplica el bloqueo en
   * caliente leyendo el estado local. Cualquier error de base de datos se
   * propaga: el guard lo convierte en 503 y NO deja pasar (falla cerrado).
   */
  async validate(payload: AccessTokenClaims): Promise<AccessTokenClaims> {
    if (payload.token_use !== 'access' || payload.client_id !== this.clientId) {
      throw new UnauthorizedException('La sesión no es válida.');
    }
    const status = await this.users.findStatusById(payload.sub);
    if (status === null) {
      throw new UnauthorizedException('Tu usuario no está registrado en la aplicación.');
    }
    if (status !== USER_STATUS.ACTIVE) {
      throw new UnauthorizedException(BLOCKED_MESSAGES[status] ?? 'Acceso denegado.');
    }
    return payload;
  }
}
```

```ts
// src/modules/auth/dto/auth.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Debe coincidir con la política de contraseñas del User Pool (16.5). */
const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,128}$/;
const PASSWORD_MESSAGE =
  'La contraseña debe tener entre 12 y 128 caracteres e incluir mayúscula, minúscula, número y un carácter especial.';

class EmailDto {
  @ApiProperty({ example: 'usuario@ejemplo.com' })
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido.' })
  @MaxLength(320)
  email: string;
}

export class LoginDto extends EmailDto {
  @ApiProperty({ example: 'Contraseña-Segura-1' })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria.' })
  @MaxLength(128)
  password: string;
}

export class SignUpDto extends EmailDto {
  @ApiProperty({ example: 'Contraseña-Segura-1' })
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  password: string;

  @ApiPropertyOptional({ example: '+51999999999', description: 'Formato E.164' })
  @IsOptional()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'El teléfono debe estar en formato E.164 (+51999999999).',
  })
  phoneNumber?: string;

  @ApiProperty({ example: 'Ana María' })
  @IsString()
  @Length(1, 100)
  firstName: string;

  @ApiProperty({ example: 'Pérez Soto' })
  @IsString()
  @Length(1, 100)
  lastName: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  @Equals(true, { message: 'Debes aceptar los términos y condiciones para continuar.' })
  acceptedTerms: boolean;
}

export class ConfirmSignUpDto extends EmailDto {
  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos.' })
  code: string;
}

export class ResendCodeDto extends EmailDto {}

export class ForgotPasswordDto extends EmailDto {}

export class ConfirmPasswordDto extends EmailDto {
  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos.' })
  code: string;

  @ApiProperty({ example: 'Contraseña-Nueva-2' })
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  newPassword: string;
}

export const SUPPORTED_CHALLENGES = [
  'SOFTWARE_TOKEN_MFA',
  'EMAIL_OTP',
  'MFA_SETUP',
  'NEW_PASSWORD_REQUIRED',
] as const;
export type SupportedChallenge = (typeof SUPPORTED_CHALLENGES)[number];

export class ChallengeResponseDto {
  @ApiProperty({ enum: SUPPORTED_CHALLENGES })
  @IsIn(SUPPORTED_CHALLENGES)
  challenge: SupportedChallenge;

  @ApiPropertyOptional({ example: '123456', description: 'Código TOTP o del correo' })
  @IsOptional()
  @Matches(/^\d{6,8}$/, { message: 'El código debe tener entre 6 y 8 dígitos.' })
  code?: string;

  @ApiPropertyOptional({ description: 'Solo para NEW_PASSWORD_REQUIRED' })
  @IsOptional()
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  newPassword?: string;
}

/** Respuestas de la API de sesión: nunca contienen tokens. */
export type SessionResponse =
  | { status: 'authenticated'; expiresAt: string }
  | { status: 'challenge'; challenge: SupportedChallenge };

export class SessionResponseDto {
  @ApiProperty({ enum: ['authenticated', 'challenge'] })
  status: 'authenticated' | 'challenge';

  @ApiPropertyOptional({
    description: 'Expiración del access token (ISO 8601). Solo si status=authenticated',
  })
  expiresAt?: string;

  @ApiPropertyOptional({ enum: SUPPORTED_CHALLENGES, description: 'Solo si status=challenge' })
  challenge?: SupportedChallenge;
}

export class MfaSetupResponseDto {
  @ApiProperty({ description: 'Secreto TOTP en base32 (para ingreso manual)' })
  secretCode: string;

  @ApiProperty({ description: 'URI otpauth:// para pintar el código QR' })
  otpauthUri: string;
}

export class MessageResponseDto {
  @ApiProperty()
  message: string;
}

export class MeResponseDto {
  @ApiProperty({ format: 'uuid' })
  sub: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiProperty({ type: [String] })
  groups: string[];

  @ApiProperty({ enum: ['active', 'blocked', 'observed', 'rejected', 'unknown'] })
  userStatus: string;

  @ApiProperty({ format: 'date-time' })
  sessionExpiresAt: string;
}
```

```ts
// src/modules/auth/auth.service.ts
import {
  AdminDeleteUserCommand,
  AssociateSoftwareTokenCommand,
  type AuthenticationResultType,
  ConfirmForgotPasswordCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  GetTokensFromRefreshTokenCommand,
  GlobalSignOutCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  RespondToAuthChallengeCommand,
  RevokeTokenCommand,
  SignUpCommand,
  VerifySoftwareTokenCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { AUDIT_ACTIONS } from '../../common/constants/audit-actions';
import type { RequestContext } from '../../common/http/request-context';
import type { EnvConfig } from '../../config/env.validation';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { COGNITO_CLIENT, type CognitoClient } from './cognito.provider';
import {
  type ChallengeResponseDto,
  type ConfirmPasswordDto,
  type ConfirmSignUpDto,
  type ForgotPasswordDto,
  type LoginDto,
  type ResendCodeDto,
  type SignUpDto,
  SUPPORTED_CHALLENGES,
  type SupportedChallenge,
} from './dto/auth.dto';
import type { ChallengeState } from './session-cookies';

export interface SessionTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  sub: string;
}

export type LoginOutcome =
  | { kind: 'session'; tokens: SessionTokens }
  | { kind: 'challenge'; challenge: SupportedChallenge; state: ChallengeState };

const GENERIC_MESSAGE = 'Si el correo está registrado, recibirás un código en unos minutos.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly userPoolId: string;
  private readonly selfSignup: boolean;

  constructor(
    @Inject(COGNITO_CLIENT) private readonly cognito: CognitoClient,
    config: ConfigService<EnvConfig, true>,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {
    this.clientId = config.get('COGNITO_CLIENT_ID', { infer: true });
    this.clientSecret = config.get('COGNITO_CLIENT_SECRET', { infer: true });
    this.userPoolId = config.get('COGNITO_USER_POOL_ID', { infer: true });
    this.selfSignup = config.get('AUTH_SELF_SIGNUP', { infer: true });
  }

  // ─── Login y retos ────────────────────────────────────────────────────────

  async login(dto: LoginDto, ctx: RequestContext): Promise<LoginOutcome> {
    try {
      const res = await this.cognito.send(
        new InitiateAuthCommand({
          AuthFlow: 'USER_PASSWORD_AUTH',
          ClientId: this.clientId,
          AuthParameters: {
            USERNAME: dto.email,
            PASSWORD: dto.password,
            SECRET_HASH: this.secretHash(dto.email),
          },
        }),
      );
      return await this.outcome(res, dto.email, ctx);
    } catch (error) {
      await this.audit.recordSafe({
        action: AUDIT_ACTIONS.USER_LOGIN_FAILED,
        actorSub: null,
        ip: ctx.ip,
        requestId: ctx.requestId,
        details: (error as { name?: string }).name,
      });
      throw this.translate(error);
    }
  }

  async respondToChallenge(
    state: ChallengeState | undefined,
    dto: ChallengeResponseDto,
    ctx: RequestContext,
  ): Promise<LoginOutcome> {
    if (!state || state.c !== dto.challenge) {
      throw new UnauthorizedException(
        'El inicio de sesión expiró. Vuelve a ingresar tu contraseña.',
      );
    }
    try {
      if (dto.challenge === 'MFA_SETUP') {
        if (!dto.code) throw new BadRequestException('Ingresa el código de tu app autenticadora.');
        const verified = await this.cognito.send(
          new VerifySoftwareTokenCommand({
            Session: state.s,
            UserCode: dto.code,
            FriendlyDeviceName: 'app',
          }),
        );
        if (verified.Status !== 'SUCCESS' || !verified.Session) {
          throw new BadRequestException('El código no es correcto.');
        }
        const res = await this.cognito.send(
          new RespondToAuthChallengeCommand({
            ClientId: this.clientId,
            ChallengeName: 'MFA_SETUP',
            Session: verified.Session,
            ChallengeResponses: { USERNAME: state.u, SECRET_HASH: this.secretHash(state.u) },
          }),
        );
        await this.audit.recordSafe({
          action: AUDIT_ACTIONS.USER_MFA_ENROLLED,
          actorSub: state.u,
          ip: ctx.ip,
          requestId: ctx.requestId,
        });
        return await this.outcome(res, state.e, ctx, state.u);
      }

      const responses: Record<string, string> = {
        USERNAME: state.u,
        SECRET_HASH: this.secretHash(state.u),
      };
      if (dto.challenge === 'NEW_PASSWORD_REQUIRED') {
        if (!dto.newPassword) throw new BadRequestException('Ingresa una contraseña nueva.');
        responses.NEW_PASSWORD = dto.newPassword;
      } else {
        if (!dto.code) throw new BadRequestException('Ingresa el código de verificación.');
        responses[dto.challenge === 'EMAIL_OTP' ? 'EMAIL_OTP_CODE' : 'SOFTWARE_TOKEN_MFA_CODE'] =
          dto.code;
      }
      const res = await this.cognito.send(
        new RespondToAuthChallengeCommand({
          ClientId: this.clientId,
          ChallengeName: dto.challenge,
          Session: state.s,
          ChallengeResponses: responses,
        }),
      );
      return await this.outcome(res, state.e, ctx, state.u);
    } catch (error) {
      throw this.translate(error);
    }
  }

  /** Paso previo a MFA_SETUP: devuelve el secreto TOTP para pintar el código QR. */
  async startMfaSetup(state: ChallengeState | undefined, issuer: string) {
    if (!state || state.c !== 'MFA_SETUP') {
      throw new UnauthorizedException(
        'El inicio de sesión expiró. Vuelve a ingresar tu contraseña.',
      );
    }
    try {
      const res = await this.cognito.send(new AssociateSoftwareTokenCommand({ Session: state.s }));
      if (!res.SecretCode || !res.Session) throw new Error('Cognito no devolvió el secreto TOTP');
      const label = encodeURIComponent(`${issuer}:${state.e}`);
      const otpauthUri = `otpauth://totp/${label}?secret=${res.SecretCode}&issuer=${encodeURIComponent(issuer)}`;
      return { secretCode: res.SecretCode, otpauthUri, state: { ...state, s: res.Session } };
    } catch (error) {
      throw this.translate(error);
    }
  }

  // ─── Sesión ───────────────────────────────────────────────────────────────

  /**
   * Con la rotación de refresh token activada en el App Client (16.5), cada
   * renovación devuelve un refresh token NUEVO e invalida el anterior tras un
   * período de gracia. GetTokensFromRefreshToken recibe el client secret
   * directamente: ya no hace falta calcular SECRET_HASH con el `sub` (22.1).
   */
  async refresh(refreshToken: string | undefined): Promise<SessionTokens> {
    if (!refreshToken) throw new UnauthorizedException('No hay una sesión activa.');
    try {
      const res = await this.cognito.send(
        new GetTokensFromRefreshTokenCommand({
          ClientId: this.clientId,
          ClientSecret: this.clientSecret,
          RefreshToken: refreshToken,
        }),
      );
      return this.tokensFrom(res.AuthenticationResult);
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === 'NotAuthorizedException' || name === 'RefreshTokenReuseException') {
        throw new UnauthorizedException('La sesión expiró. Vuelve a iniciar sesión.');
      }
      throw this.translate(error);
    }
  }

  /** Cierra ESTA sesión: revoca el refresh token y los access tokens emitidos con él. */
  async logout(refreshToken: string | undefined, actorSub: string | null, ctx: RequestContext) {
    if (refreshToken) {
      try {
        await this.cognito.send(
          new RevokeTokenCommand({
            ClientId: this.clientId,
            ClientSecret: this.clientSecret,
            Token: refreshToken,
          }),
        );
      } catch (error) {
        this.logger.warn({ err: error }, 'RevokeToken falló; se limpian las cookies igualmente');
      }
    }
    await this.audit.recordSafe({
      action: AUDIT_ACTIONS.USER_LOGOUT,
      actorSub,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
  }

  /** Cierra la sesión en TODOS los dispositivos del usuario. */
  async logoutAll(accessToken: string, actorSub: string, ctx: RequestContext) {
    try {
      await this.cognito.send(new GlobalSignOutCommand({ AccessToken: accessToken }));
    } catch (error) {
      throw this.translate(error);
    }
    await this.audit.recordSafe({
      action: AUDIT_ACTIONS.USER_LOGOUT_ALL,
      actorSub,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
  }

  // ─── Registro y recuperación ──────────────────────────────────────────────

  async signUp(dto: SignUpDto, ctx: RequestContext) {
    if (!this.selfSignup) {
      throw new ForbiddenException(
        'El registro está cerrado. Solicita una invitación al administrador.',
      );
    }
    let userSub: string | undefined;
    try {
      const res = await this.cognito.send(
        new SignUpCommand({
          ClientId: this.clientId,
          Username: dto.email,
          Password: dto.password,
          SecretHash: this.secretHash(dto.email),
          UserAttributes: [
            { Name: 'email', Value: dto.email },
            { Name: 'given_name', Value: dto.firstName },
            { Name: 'family_name', Value: dto.lastName },
            ...(dto.phoneNumber ? [{ Name: 'phone_number', Value: dto.phoneNumber }] : []),
          ],
        }),
      );
      userSub = res.UserSub;
    } catch (error) {
      // Anti-enumeración: un email ya registrado responde igual que uno nuevo.
      if ((error as { name?: string }).name === 'UsernameExistsException') {
        return { message: 'Te enviamos un código de verificación a tu correo.' };
      }
      throw this.translate(error);
    }
    if (!userSub)
      throw new ServiceUnavailableException('Cognito no devolvió el identificador del usuario.');

    try {
      const termsVersion =
        (await this.users.getSetting('terms_and_conditions_url')) ?? '<TERMS_URL>';
      await this.users.create({
        id: userSub,
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phoneNumber: dto.phoneNumber ?? null,
        acceptedTerms: dto.acceptedTerms,
        termsVersion,
        ip: ctx.ip,
        requestId: ctx.requestId,
      });
    } catch (dbError) {
      // Rollback: sin esto la identidad queda huérfana en Cognito y el usuario
      // no puede volver a registrarse ni entrar.
      await this.cognito
        .send(new AdminDeleteUserCommand({ UserPoolId: this.userPoolId, Username: userSub }))
        .catch((e: unknown) => this.logger.error({ err: e, userSub }, 'Rollback de Cognito falló'));
      throw dbError;
    }
    return { message: 'Te enviamos un código de verificación a tu correo.' };
  }

  async confirmSignUp(dto: ConfirmSignUpDto, ctx: RequestContext) {
    try {
      await this.cognito.send(
        new ConfirmSignUpCommand({
          ClientId: this.clientId,
          Username: dto.email,
          ConfirmationCode: dto.code,
          SecretHash: this.secretHash(dto.email),
        }),
      );
    } catch (error) {
      throw this.translate(error);
    }
    const user = await this.users.confirmByEmail(dto.email);
    await this.audit.recordSafe({
      action: AUDIT_ACTIONS.USER_CONFIRM_SIGNUP,
      actorSub: user.id,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
    return { message: 'Cuenta confirmada. Ya puedes iniciar sesión.' };
  }

  async resendCode(dto: ResendCodeDto) {
    try {
      await this.cognito.send(
        new ResendConfirmationCodeCommand({
          ClientId: this.clientId,
          Username: dto.email,
          SecretHash: this.secretHash(dto.email),
        }),
      );
    } catch (error) {
      if (!this.isEnumerationError(error)) throw this.translate(error);
    }
    return { message: GENERIC_MESSAGE };
  }

  async forgotPassword(dto: ForgotPasswordDto, ctx: RequestContext) {
    try {
      await this.cognito.send(
        new ForgotPasswordCommand({
          ClientId: this.clientId,
          Username: dto.email,
          SecretHash: this.secretHash(dto.email),
        }),
      );
    } catch (error) {
      if (!this.isEnumerationError(error)) throw this.translate(error);
    }
    const user = await this.users.findByEmail(dto.email);
    await this.audit.recordSafe({
      action: AUDIT_ACTIONS.USER_FORGOT_PASSWORD,
      actorSub: user?.id ?? null,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
    return { message: GENERIC_MESSAGE };
  }

  async confirmForgotPassword(dto: ConfirmPasswordDto, ctx: RequestContext) {
    try {
      await this.cognito.send(
        new ConfirmForgotPasswordCommand({
          ClientId: this.clientId,
          Username: dto.email,
          ConfirmationCode: dto.code,
          Password: dto.newPassword,
          SecretHash: this.secretHash(dto.email),
        }),
      );
    } catch (error) {
      throw this.translate(error);
    }
    const user = await this.users.findByEmail(dto.email);
    await this.audit.recordSafe({
      action: AUDIT_ACTIONS.USER_CONFIRM_PASSWORD,
      actorSub: user?.id ?? null,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
    return { message: 'Contraseña restablecida. Ya puedes iniciar sesión.' };
  }

  // ─── Internos ─────────────────────────────────────────────────────────────

  private async outcome(
    res: {
      AuthenticationResult?: AuthenticationResultType;
      ChallengeName?: string;
      Session?: string;
      ChallengeParameters?: Record<string, string>;
    },
    email: string,
    ctx: RequestContext,
    previousUsername?: string,
  ): Promise<LoginOutcome> {
    if (res.AuthenticationResult) {
      const tokens = this.tokensFrom(res.AuthenticationResult);
      await this.audit.recordSafe({
        action: AUDIT_ACTIONS.USER_LOGIN,
        actorSub: tokens.sub,
        ip: ctx.ip,
        requestId: ctx.requestId,
      });
      return { kind: 'session', tokens };
    }
    const challenge = res.ChallengeName as SupportedChallenge | undefined;
    if (!challenge || !res.Session || !SUPPORTED_CHALLENGES.includes(challenge)) {
      this.logger.error({ challenge: res.ChallengeName }, 'Reto de Cognito no soportado');
      throw new BadRequestException('Este método de verificación no está habilitado.');
    }
    return {
      kind: 'challenge',
      challenge,
      state: {
        c: challenge,
        s: res.Session,
        // Cognito solo envía USER_ID_FOR_SRP en el primer reto: en los encadenados se arrastra.
        u: res.ChallengeParameters?.USER_ID_FOR_SRP ?? previousUsername ?? email,
        e: email,
      },
    };
  }

  private tokensFrom(result: AuthenticationResultType | undefined): SessionTokens {
    if (!result?.AccessToken || !result.ExpiresIn) {
      throw new ServiceUnavailableException('Cognito no devolvió tokens.');
    }
    return {
      accessToken: result.AccessToken,
      refreshToken: result.RefreshToken,
      expiresIn: result.ExpiresIn,
      sub: decodeSub(result.AccessToken),
    };
  }

  /** HMAC requerido por Cognito cuando el App Client tiene secreto (10.2). */
  private secretHash(username: string): string {
    return createHmac('sha256', this.clientSecret)
      .update(username + this.clientId)
      .digest('base64');
  }

  private isEnumerationError(error: unknown): boolean {
    const name = (error as { name?: string }).name;
    return name === 'UserNotFoundException' || name === 'InvalidParameterException';
  }

  /** Traduce errores de Cognito a HTTP sin filtrar detalles internos. */
  private translate(error: unknown): HttpException {
    if (error instanceof HttpException) return error;
    const name = (error as { name?: string }).name ?? 'Error';
    switch (name) {
      case 'NotAuthorizedException':
      case 'UserNotFoundException':
        return new UnauthorizedException('Correo o contraseña incorrectos.');
      case 'UserNotConfirmedException':
        return new ForbiddenException('Debes confirmar tu cuenta. Revisa tu correo.');
      case 'PasswordResetRequiredException':
        return new ForbiddenException('Debes restablecer tu contraseña.');
      case 'CodeMismatchException':
      case 'EnableSoftwareTokenMFAException':
        return new BadRequestException('El código no es correcto.');
      case 'ExpiredCodeException':
        return new BadRequestException('El código expiró. Solicita uno nuevo.');
      case 'InvalidPasswordException':
        return new BadRequestException('La contraseña no cumple la política de seguridad.');
      case 'LimitExceededException':
      case 'TooManyRequestsException':
      case 'TooManyFailedAttemptsException':
        return new HttpException('Demasiados intentos. Espera unos minutos.', 429);
      default:
        this.logger.error({ err: error }, 'Error inesperado de Cognito');
        return new ServiceUnavailableException('El servicio de autenticación no está disponible.');
    }
  }
}

/** El token acaba de llegar de Cognito por TLS: leer su payload sin verificar es seguro aquí. */
function decodeSub(jwt: string): string {
  try {
    const payload = JSON.parse(
      Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as {
      sub?: string;
    };
    return payload.sub ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
```

```ts
// src/modules/auth/auth.controller.ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser, type CurrentUserPayload } from '../../common/auth/current-user';
import { Public } from '../../common/auth/roles';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { UsersService } from '../users/users.service';
import { AuthService, type LoginOutcome } from './auth.service';
import {
  ChallengeResponseDto,
  ConfirmPasswordDto,
  ConfirmSignUpDto,
  ForgotPasswordDto,
  LoginDto,
  MeResponseDto,
  MessageResponseDto,
  MfaSetupResponseDto,
  ResendCodeDto,
  type SessionResponse,
  SessionResponseDto,
  SignUpDto,
} from './dto/auth.dto';
import { SessionCookies } from './session-cookies';

const MFA_ISSUER = '<org> <app-short>';

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly cookies: SessionCookies,
  ) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Iniciar sesión. Emite cookies de sesión o devuelve un reto (MFA, cambio de contraseña)',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  async login(
    @Body() dto: LoginDto,
    @ReqCtx() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    return this.apply(res, await this.auth.login(dto, ctx));
  }

  @Post('challenge')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Responder al reto pendiente (código MFA, alta de MFA o contraseña nueva)',
  })
  @ApiOkResponse({ type: SessionResponseDto })
  async challenge(
    @Body() dto: ChallengeResponseDto,
    @ReqCtx() ctx: RequestContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    return this.apply(
      res,
      await this.auth.respondToChallenge(this.cookies.challenge(req), dto, ctx),
    );
  }

  @Post('challenge/mfa-setup')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Obtener el secreto TOTP (y su URI otpauth para el QR) durante el alta de MFA',
  })
  @ApiOkResponse({ type: MfaSetupResponseDto })
  async mfaSetup(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.startMfaSetup(this.cookies.challenge(req), MFA_ISSUER);
    this.cookies.setChallenge(res, result.state);
    return { secretCode: result.secretCode, otpauthUri: result.otpauthUri };
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renovar la sesión con la cookie de refresh (rota el refresh token)' })
  @ApiOkResponse({ type: SessionResponseDto })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionResponse> {
    try {
      const tokens = await this.auth.refresh(this.cookies.refreshToken(req));
      this.cookies.setSession(res, tokens);
      return { status: 'authenticated', expiresAt: expiresAt(tokens.expiresIn) };
    } catch (error) {
      this.cookies.clearAll(res);
      throw error;
    }
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cerrar esta sesión (funciona aunque el access token haya expirado)' })
  @ApiNoContentResponse()
  async logout(
    @Req() req: Request,
    @ReqCtx() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    // Ruta pública (el access token puede haber expirado): el sub se lee sin
    // verificar, solo para la auditoría. Nunca se usa para autorizar.
    const sub = unverifiedSub(this.cookies.accessToken(req));
    await this.auth.logout(this.cookies.refreshToken(req), sub, ctx);
    this.cookies.clearAll(res);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cerrar la sesión en todos los dispositivos' })
  @ApiNoContentResponse()
  async logoutAll(
    @Req() req: Request,
    @CurrentUser() user: CurrentUserPayload,
    @ReqCtx() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const accessToken = this.cookies.accessToken(req);
    if (!accessToken) throw new UnauthorizedException('No hay una sesión activa.');
    await this.auth.logoutAll(accessToken, user.sub, ctx);
    this.cookies.clearAll(res);
  }

  @Get('me')
  @ApiOperation({ summary: 'Perfil del usuario de la sesión actual' })
  @ApiOkResponse({ type: MeResponseDto })
  async me(@CurrentUser() user: CurrentUserPayload): Promise<MeResponseDto> {
    const dbUser = await this.users.findById(user.sub);
    return {
      sub: user.sub,
      email: dbUser?.email ?? '',
      firstName: dbUser?.firstName ?? '',
      lastName: dbUser?.lastName ?? '',
      groups: user.groups,
      userStatus: dbUser?.userStatus ?? 'unknown',
      sessionExpiresAt: new Date(user.exp * 1000).toISOString(),
    };
  }

  @Get('terms-link')
  @Public()
  @ApiOperation({ summary: 'Enlace vigente de términos y condiciones' })
  async termsLink() {
    return { url: (await this.users.getSetting('terms_and_conditions_url')) ?? '<TERMS_URL>' };
  }

  @Post('signup')
  @Public()
  @ApiOperation({ summary: 'Registro (solo si AUTH_SELF_SIGNUP=true)' })
  @ApiOkResponse({ type: MessageResponseDto })
  signUp(@Body() dto: SignUpDto, @ReqCtx() ctx: RequestContext) {
    return this.auth.signUp(dto, ctx);
  }

  @Post('confirm')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirmar la cuenta con el código del correo' })
  @ApiOkResponse({ type: MessageResponseDto })
  confirm(@Body() dto: ConfirmSignUpDto, @ReqCtx() ctx: RequestContext) {
    return this.auth.confirmSignUp(dto, ctx);
  }

  @Post('resend-code')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reenviar el código de confirmación' })
  @ApiOkResponse({ type: MessageResponseDto })
  resendCode(@Body() dto: ResendCodeDto) {
    return this.auth.resendCode(dto);
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Solicitar código para restablecer la contraseña' })
  @ApiOkResponse({ type: MessageResponseDto })
  forgotPassword(@Body() dto: ForgotPasswordDto, @ReqCtx() ctx: RequestContext) {
    return this.auth.forgotPassword(dto, ctx);
  }

  @Post('confirm-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Fijar la contraseña nueva con el código recibido' })
  @ApiOkResponse({ type: MessageResponseDto })
  confirmPassword(@Body() dto: ConfirmPasswordDto, @ReqCtx() ctx: RequestContext) {
    return this.auth.confirmForgotPassword(dto, ctx);
  }

  private apply(res: Response, outcome: LoginOutcome): SessionResponse {
    if (outcome.kind === 'session') {
      this.cookies.setSession(res, outcome.tokens);
      return { status: 'authenticated', expiresAt: expiresAt(outcome.tokens.expiresIn) };
    }
    this.cookies.setChallenge(res, outcome.state);
    return { status: 'challenge', challenge: outcome.challenge };
  }
}

function unverifiedSub(jwt: string | undefined): string | null {
  if (!jwt) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as {
      sub?: unknown;
    };
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

function expiresAt(expiresIn: number): string {
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}
```

```ts
// src/modules/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { cognitoClientProvider } from './cognito.provider';
import { jwtKeyProvider } from './jwt-key.provider';
import { JwtStrategy } from './jwt.strategy';
import { SessionCookies } from './session-cookies';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    UsersModule,
    AuditModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, SessionCookies, cognitoClientProvider, jwtKeyProvider],
})
export class AuthModule {}
```

`COGNITO_CLIENT` y `JWT_KEY_PROVIDER` son símbolos de inyección. En producción el primero es el SDK y el segundo descarga el JWKS. En tests se sustituyen los dos (15.2): no hay user pool en la suite.

### 10.6 Usuarios y estado

La fila local existe desde el signup (o desde `create-admin` del migrator). El id es el `sub` de Cognito, no un uuid generado por la base: así el JWT y la fila son la misma clave y no hace falta una consulta de más para traducir.

```ts
// src/modules/users/users.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { DataSource, Repository } from 'typeorm';
import { AUDIT_ACTIONS } from '../../common/constants/audit-actions';
import { AuditService } from '../audit/audit.service';
import { Setting } from './setting.entity';
import { UserTermsAcceptance } from './user-terms-acceptance.entity';
import { COGNITO_STATUS, User, USER_STATUS, type UserStatus } from './user.entity';

export interface CreateUserInput {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phoneNumber: string | null;
  acceptedTerms: boolean;
  termsVersion: string;
  ip: string;
  requestId: string;
}

export interface ActorContext {
  actorSub: string;
  ip: string;
  requestId: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Setting) private readonly settings: Repository<Setting>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  /** Crea el usuario local, su consentimiento y su auditoría en UNA transacción. */
  async create(input: CreateUserInput): Promise<User> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(User);
      // insert(), NO save(): save() hace UPDATE si la PK ya existe y pisaría a otro usuario.
      const user = repo.create({
        id: input.id,
        email: input.email.toLowerCase(),
        firstName: input.firstName,
        lastName: input.lastName,
        phoneNumber: input.phoneNumber,
        cognitoStatus: COGNITO_STATUS.UNCONFIRMED,
        userStatus: USER_STATUS.ACTIVE,
        acceptedTermsAt: input.acceptedTerms ? new Date() : null,
      });
      await repo.insert(user);
      if (input.acceptedTerms) {
        await manager.getRepository(UserTermsAcceptance).insert({
          userSub: user.id,
          termsKey: 'terms_and_conditions_url',
          termsVersion: input.termsVersion,
          ip: input.ip,
          requestId: input.requestId,
        });
      }
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.USER_SIGNUP,
          actorSub: user.id,
          ip: input.ip,
          requestId: input.requestId,
          entityType: 'user',
          entityId: user.id,
        },
        manager,
      );
      return user;
    });
  }

  async confirmByEmail(email: string): Promise<User> {
    const user = await this.findByEmail(email);
    if (!user) throw new NotFoundException('Usuario no encontrado.');
    user.cognitoStatus = COGNITO_STATUS.CONFIRMED;
    return this.users.save(user);
  }

  async updateStatus(id: string, userStatus: UserStatus, actor: ActorContext): Promise<User> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(User);
      const user = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!user) throw new NotFoundException('Usuario no encontrado.');
      const before = { userStatus: user.userStatus };
      user.userStatus = userStatus;
      const saved = await repo.save(user);
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.ADMIN_UPDATE_USER_STATUS,
          actorSub: actor.actorSub,
          ip: actor.ip,
          requestId: actor.requestId,
          entityType: 'user',
          entityId: id,
          before,
          after: { userStatus },
        },
        manager,
      );
      return saved;
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.users.findOneBy({ id });
  }

  /** Solo la columna que necesita JwtStrategy: es la consulta más frecuente del sistema. */
  async findStatusById(id: string): Promise<UserStatus | null> {
    const row = await this.users.findOne({ where: { id }, select: { userStatus: true } });
    return row?.userStatus ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    if (!email) return null;
    return this.users.findOneBy({ email: email.trim().toLowerCase() });
  }

  async getSetting(key: string): Promise<string | null> {
    const setting = await this.settings.findOneBy({ key });
    return setting?.value ?? null;
  }
}
```

```ts
// src/modules/users/users.controller.ts
import { Body, Controller, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { CurrentUser, type CurrentUserPayload } from '../../common/auth/current-user';
import { ADMIN_ROLE, Roles } from '../../common/auth/roles';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { USER_STATUS, type UserStatus } from './user.entity';
import { UsersService } from './users.service';

export class UpdateUserStatusDto {
  @IsIn(Object.values(USER_STATUS), {
    message: `El estado debe ser uno de: ${Object.values(USER_STATUS).join(', ')}.`,
  })
  userStatus: UserStatus;
}

@ApiTags('Usuarios')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Patch(':id/status')
  @Roles(ADMIN_ROLE)
  @ApiOperation({ summary: 'Cambiar el estado administrativo de un usuario (admin)' })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() admin: CurrentUserPayload,
    @ReqCtx() ctx: RequestContext,
  ) {
    const user = await this.users.updateStatus(id, dto.userStatus, {
      actorSub: admin.sub,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
    return { id: user.id, userStatus: user.userStatus };
  }
}
```

```ts
// src/modules/users/users.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { Setting } from './setting.entity';
import { UserTermsAcceptance } from './user-terms-acceptance.entity';
import { User } from './user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Setting, UserTermsAcceptance]), AuditModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

`create()` usa `insert()`, no `save()`. `save()` con un id ya presente hace `UPDATE`. En una condición de carrera del signup eso sobrescribiría la fila de otro alta en vez de fallar con 23505. `updateStatus` toma un lock pesimista y escribe la auditoría en la misma transacción.

`PATCH /api/users/:id/status` exige `<ROL_B>`. Desactivar a un usuario no revoca por sí solo sus refresh tokens: el administrador que desactiva llama también al flujo de `logout-all` de ese usuario (queda como paso del servicio de dominio cuando exista la pantalla; el endpoint `logout-all` ya revoca la sesión de quien llama). Un usuario `disabled` recibe 403 en el guard aunque su access token siga siendo válido, así que el efecto es inmediato para la API.

---
## 11. Capa de datos: entidades, convenciones y migraciones

### 11.1 Convenciones que cumplen todas las entidades

🆕 **V2.**

| Tema | Convención |
|---|---|
| Nombres | `SnakeNamingStrategy`: `createdAt` → `created_at`. No escribir `name:` en cada columna |
| Clave primaria | `uuid` con `gen_random_uuid()`, salvo `users.id`, que es el `sub` de Cognito |
| Fechas | `timestamptz`. Nunca `timestamp` sin zona |
| Dinero | `numeric(p, s)` en SQL, `string` en TypeScript, `decimal.js` para operar |
| Enumeraciones | `varchar` + `@Check` + unión de constantes en TS. No `ENUM` de PostgreSQL: añadir un valor es un `ALTER TYPE` que no cabe en una transacción usable y rompe el despliegue (22.20) |
| Concurrencia | `@VersionColumn()` en toda entidad que se edita. El `UPDATE` lleva `WHERE id = ? AND version = ?`; 0 filas es 409 |
| Borrado | No hay borrado físico de negocio. Estado (`active`/`disabled`) o, en documentos, `quarantined` |
| `synchronize` | `false` siempre. El cambio de esquema es una migración |
| Lista de entidades | Explícita en `src/database/entities.ts`. Un glob no sobrevive al bundle de esbuild |

### 11.2 Entidades del núcleo

```ts
// src/modules/users/user.entity.ts
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

export const USER_STATUS = {
  ACTIVE: 'active',
  BLOCKED: 'blocked',
  OBSERVED: 'observed',
  REJECTED: 'rejected',
} as const;
export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

export const COGNITO_STATUS = { UNCONFIRMED: 'unconfirmed', CONFIRMED: 'confirmed' } as const;
export type CognitoStatus = (typeof COGNITO_STATUS)[keyof typeof COGNITO_STATUS];

@Entity('users')
@Check(`"user_status" IN ('active','blocked','observed','rejected')`)
@Check(`"cognito_status" IN ('unconfirmed','confirmed')`)
@Check(`"email" = lower("email")`)
export class User {
  /** `sub` de Cognito. No se genera: lo asigna Cognito al crear la identidad. */
  @PrimaryColumn('uuid')
  id: string;

  /** Siempre en minúsculas (lo garantiza el CHECK); así el índice único sirve para buscar. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 320 })
  email: string;

  @Column({ type: 'varchar', length: 100 })
  firstName: string;

  @Column({ type: 'varchar', length: 100 })
  lastName: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phoneNumber: string | null;

  @Column({ type: 'varchar', length: 20, default: COGNITO_STATUS.UNCONFIRMED })
  cognitoStatus: CognitoStatus;

  @Column({ type: 'varchar', length: 20, default: USER_STATUS.ACTIVE })
  userStatus: UserStatus;

  @Column({ type: 'timestamptz', nullable: true })
  acceptedTermsAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  /** Bloqueo optimista: dos ediciones concurrentes no se pisan en silencio (12.8). */
  @VersionColumn({ default: 1 })
  version: number;
}
```

```ts
// src/modules/users/setting.entity.ts
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Parámetros globales editables sin redeploy. El valor es texto; el consumidor lo parsea. */
@Entity('settings')
export class Setting {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  key: string;

  @Column({ type: 'text' })
  value: string;

  /** Para qué sirve, tipo esperado y rango válido. Obligatorio documentarlo aquí. */
  @Column({ type: 'text' })
  description: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
```

```ts
// src/modules/users/user-terms-acceptance.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

/** Registro append-only de consentimiento: quién aceptó qué versión, desde dónde y cuándo. */
@Entity('user_terms_acceptances')
export class UserTermsAcceptance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userSub: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_sub' })
  user: User;

  @Column({ type: 'varchar', length: 100 })
  termsKey: string;

  /** URL o versión vigente del documento aceptado. */
  @Column({ type: 'text' })
  termsVersion: string;

  @Column({ type: 'varchar', length: 45 })
  ip: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  requestId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  acceptedAt: Date;
}
```

```ts
// src/modules/audit/audit-log.entity.ts
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Bitácora de auditoría. Es append-only a nivel de base de datos (un trigger
 * impide UPDATE y DELETE, ver la migración inicial). No tiene FK a `users`
 * a propósito: la auditoría debe sobrevivir al borrado de lo que audita.
 */
@Entity('audit_logs')
@Index(['actorSub', 'occurredAt'])
@Index(['entityType', 'entityId'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  occurredAt: Date;

  /** `sub` del usuario, o null para acciones del sistema / anónimas. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  actorSub: string | null;

  @Column({ type: 'varchar', length: 64 })
  action: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  entityType: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  entityId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  before: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  requestId: string | null;

  @Column({ type: 'text', nullable: true })
  details: string | null;
}
```

```ts
// src/modules/audit/audit.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager, Repository } from 'typeorm';
import type { AuditAction } from '../../common/constants/audit-actions';
import { AuditLog } from './audit-log.entity';

export interface AuditEvent {
  action: AuditAction;
  actorSub: string | null;
  ip?: string | null;
  requestId?: string | null;
  entityType?: string;
  entityId?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  details?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>) {}

  /**
   * Registra un evento. Pasar `manager` cuando el cambio auditado ocurre dentro
   * de una transacción: así el registro de auditoría se confirma o se revierte
   * junto con el cambio, y nunca existe uno sin el otro.
   */
  async record(event: AuditEvent, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(AuditLog) : this.repo;
    await repo.save(
      repo.create({
        action: event.action,
        actorSub: event.actorSub,
        ip: event.ip ?? null,
        requestId: event.requestId ?? null,
        entityType: event.entityType ?? null,
        entityId: event.entityId ?? null,
        before: event.before ?? null,
        after: event.after ?? null,
        details: event.details ?? null,
      }),
      { reload: false },
    );
  }

  /**
   * Para eventos que no deben bloquear la respuesta si la auditoría falla
   * (login, logout). El fallo queda en los logs y dispara la alarma de errores.
   */
  async recordSafe(event: AuditEvent): Promise<void> {
    try {
      await this.record(event);
    } catch (error) {
      this.logger.error({ err: error, action: event.action }, 'No se pudo registrar auditoría');
    }
  }
}
```

```ts
// src/modules/audit/audit.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from './audit-log.entity';
import { AuditService } from './audit.service';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog])],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
```

```ts
// src/modules/documents/document.entity.ts
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export const DOCUMENT_STATUS = {
  PENDING_UPLOAD: 'pending_upload',
  SCANNING: 'scanning',
  PROCESSING: 'processing',
  PROCESSED: 'processed',
  FAILED: 'failed',
  QUARANTINED: 'quarantined',
} as const;
export type DocumentStatus = (typeof DOCUMENT_STATUS)[keyof typeof DOCUMENT_STATUS];

@Entity('documents')
@Check(`"status" IN ('pending_upload','scanning','processing','processed','failed','quarantined')`)
// Deduplicación garantizada por la base, incluso con dos subidas concurrentes (22.14).
@Index(['entityId', 'documentType', 'sha256'], {
  unique: true,
  where: `"status" <> 'quarantined'`,
})
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  filename: string;

  @Column({ type: 'varchar', length: 1024 })
  s3Key: string;

  /** Identificador natural de la entidad de negocio dueña del documento (<ENTITY_ID>). */
  @Index()
  @Column({ type: 'varchar', length: 64 })
  entityId: string;

  @Column({ type: 'varchar', length: 50 })
  documentType: string;

  @Column({ type: 'varchar', length: 20, default: DOCUMENT_STATUS.PENDING_UPLOAD })
  status: DocumentStatus;

  @Column({ type: 'char', length: 64 })
  sha256: string;

  @Column({ type: 'varchar', length: 100 })
  contentType: string;

  @Column({ type: 'integer' })
  sizeBytes: number;

  @Column({ type: 'varchar', length: 30, nullable: true })
  validationStatus: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  parserVersion: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'uuid', nullable: true })
  uploadedBySub: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'uploaded_by_sub' })
  uploadedBy: User | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
```

`audit_logs` no tiene FK hacia `users`. Un usuario se puede desactivar; su rastro no debe depender de que la fila siga existiendo, y un `ON DELETE CASCADE` borraría la auditoría. `before`/`after` son `jsonb` con el diff que el servicio decidió guardar, no la fila entera por defecto.

```ts
// src/database/entities.ts
import { AuditLog } from '../modules/audit/audit-log.entity';
import { Project } from '../modules/projects/project.entity';
import { Document } from '../modules/documents/document.entity';
import { Setting } from '../modules/users/setting.entity';
import { UserTermsAcceptance } from '../modules/users/user-terms-acceptance.entity';
import { User } from '../modules/users/user.entity';

/**
 * Lista explícita de entidades. Se usa en la app, en el CLI y en la Lambda
 * migrator. Los globs no funcionan dentro de un bundle de esbuild, y una
 * entidad olvidada produce migraciones que borran su tabla: el test
 * `entities.spec.ts` falla si algún *.entity.ts no está aquí.
 */
export const ENTITIES = [User, Setting, UserTermsAcceptance, AuditLog, Document, Project];
```

`Project` está en la lista porque es el módulo de ejemplo (12). Al sustituirlo por el dominio nuevo, se quita de esta lista y se añaden las entidades reales. Olvidar la lista es un fallo silencioso: TypeORM no mapea la tabla y el primer `getRepository` revienta en runtime, no al compilar.

### 11.3 Roles de base de datos

Hay dos roles y no se intercambian.

| Rol | Contraseña | Cómo entra | Privilegios |
|---|---|---|---|
| `postgres` (maestro) | Secrets Manager, rotada cada 30 días por RDS | Solo la Lambda `migrator`, **directo a la instancia**, con TLS | Dueño del esquema: DDL, extensiones, el rol de la app |
| `app_user` | Ninguna. `GRANT rds_iam` | La Lambda de la API y el worker, **a través de RDS Proxy**, con un token IAM de 15 min | `SELECT`/`INSERT`/`UPDATE`/`DELETE` sobre las tablas de la app. `UPDATE` y `DELETE` revocados sobre `audit_logs` |

```ts
// src/database/db-roles.ts
import type { DataSource } from 'typeorm';

/**
 * Asegura el rol `app_user` (solo DML) que usa la API. Lo ejecuta la Lambda
 * migrator como usuario maestro, después de las migraciones. Es idempotente.
 *
 * - En AWS, `app_user` es IAM-only (`rds_iam`): no tiene contraseña. La API
 *   entra por RDS Proxy con un token IAM, y el proxy entra a la base también
 *   con IAM (autenticación de extremo a extremo, 16.4).
 * - En local, `app_user` no se usa (la app entra como `postgres`), pero el
 *   rol se crea igual para que los permisos se prueben en CI.
 * - Los privilegios por defecto hacen que toda tabla creada después por una
 *   migración quede accesible para app_user sin GRANT explícito.
 */
export async function ensureAppRole(
  db: DataSource,
  opts: { iam: boolean; database: string },
): Promise<void> {
  await db.transaction(async (m) => {
    const exists: unknown[] = await m.query(`SELECT 1 FROM pg_roles WHERE rolname = 'app_user'`);
    if (exists.length === 0) {
      await m.query(`CREATE ROLE app_user LOGIN`);
    }
    if (opts.iam) {
      await m.query(`GRANT rds_iam TO app_user`);
    }
    await m.query(`GRANT CONNECT ON DATABASE ${quoteIdent(opts.database)} TO app_user`);
    await m.query(`GRANT USAGE ON SCHEMA public TO app_user`);
    await m.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user`,
    );
    await m.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user`);
    await m.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user`,
    );
    await m.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user`,
    );
    // La bitácora es append-only también para la aplicación.
    const audit: Array<{ t: string | null }> = await m.query(
      `SELECT to_regclass('public.audit_logs') AS t`,
    );
    if (audit[0]?.t) {
      await m.query(`REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM app_user`);
    }
  });
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
```

`ensureAppRole` es idempotente y lo corre el migrator antes de las migraciones. No crea una contraseña: un rol con `LOGIN` y contraseña sería una puerta trasera al lado del IAM. El `REVOKE` de escritura sobre `audit_logs` se repite en cada corrida por si una migración nueva rehízo los grants.

La API no puede conectarse como `postgres`. El proxy solo tiene el secreto de IAM de `app_user`, y el grupo de seguridad de la instancia solo acepta tráfico desde el proxy y desde el security group del migrator.

### 11.4 Migraciones

```ts
// src/migrations/index.ts
import { AddProjects1791414493019 } from './1791414493019-AddProjects';
import { Init1791412463667 } from './1791412463667-Init';

/**
 * Lista explícita y ordenada de migraciones (misma razón que database/entities.ts).
 * Al generar una migración nueva, añadirla AL FINAL de este array en el mismo commit.
 */
export const MIGRATIONS: Function[] = [Init1791412463667, AddProjects1791414493019];
```

```ts
// src/migrations/1791412463667-Init.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1791412463667 implements MigrationInterface {
  name = 'Init1791412463667';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "actor_sub" character varying(64), "action" character varying(64) NOT NULL, "entity_type" character varying(64), "entity_id" character varying(64), "before" jsonb, "after" jsonb, "ip" character varying(45), "request_id" character varying(64), "details" text, CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_36cd4615fabad14abad075ffc9" ON "audit_logs"  ("occurred_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7421efc125d95e413657efa3c6" ON "audit_logs"  ("entity_type", "entity_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cf035c59c611eef2ca6eb1dfdd" ON "audit_logs"  ("actor_sub", "occurred_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL, "email" character varying(320) NOT NULL, "first_name" character varying(100) NOT NULL, "last_name" character varying(100) NOT NULL, "phone_number" character varying(20), "cognito_status" character varying(20) NOT NULL DEFAULT 'unconfirmed', "user_status" character varying(20) NOT NULL DEFAULT 'active', "accepted_terms_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "version" integer NOT NULL DEFAULT '1', CONSTRAINT "CHK_90033ffeb5b67effb487588d20" CHECK ("email" = lower("email")), CONSTRAINT "CHK_c08f4be6ab85765ad204f6ed12" CHECK ("cognito_status" IN ('unconfirmed','confirmed')), CONSTRAINT "CHK_a3a239f2a828d4517d20558bb5" CHECK ("user_status" IN ('active','blocked','observed','rejected')), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_97672ac88f789774dd47f7c8be" ON "users"  ("email") `,
    );
    await queryRunner.query(
      `CREATE TABLE "documents" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "filename" character varying(255) NOT NULL, "s3_key" character varying(1024) NOT NULL, "entity_id" character varying(64) NOT NULL, "document_type" character varying(50) NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'pending_upload', "sha256" character(64) NOT NULL, "content_type" character varying(100) NOT NULL, "size_bytes" integer NOT NULL, "validation_status" character varying(30), "parser_version" character varying(30), "processed_at" TIMESTAMP WITH TIME ZONE, "error_message" text, "uploaded_by_sub" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_3b384f49fe6661383be6d5a1cf" CHECK ("status" IN ('pending_upload','scanning','processing','processed','failed','quarantined')), CONSTRAINT "PK_ac51aa5181ee2036f5ca482857c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_affc3911eff37e11869f2fbd3b" ON "documents"  ("entity_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_d7f225a1bd33741a7751c8a5c1" ON "documents"  ("entity_id", "document_type", "sha256") WHERE "status" <> 'quarantined'`,
    );
    await queryRunner.query(
      `CREATE TABLE "settings" ("key" character varying(100) NOT NULL, "value" text NOT NULL, "description" text NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_c8639b7626fa94ba8265628f214" PRIMARY KEY ("key"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_terms_acceptances" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_sub" uuid NOT NULL, "terms_key" character varying(100) NOT NULL, "terms_version" text NOT NULL, "ip" character varying(45) NOT NULL, "request_id" character varying(64), "accepted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_4e2e665813b069bff3530d906fc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d3dfc323c3963a0414230da302" ON "user_terms_acceptances"  ("user_sub") `,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" ADD CONSTRAINT "FK_6badfe35ef25ec8ff1cd337c7cf" FOREIGN KEY ("uploaded_by_sub") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_terms_acceptances" ADD CONSTRAINT "FK_d3dfc323c3963a0414230da3025" FOREIGN KEY ("user_sub") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    // Bitácora append-only: ni siquiera el dueño de la tabla puede modificarla
    // sin desactivar explícitamente el trigger (solo lo hace la purga por retención, 26.4).
    await queryRunner.query(
      `CREATE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit_logs es append-only'; END $$`,
    );
    await queryRunner.query(
      `CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable()`,
    );
    await queryRunner.query(
      `CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON "audit_logs" FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS audit_logs_no_truncate ON "audit_logs"`);
    await queryRunner.query(`DROP TRIGGER IF EXISTS audit_logs_no_update ON "audit_logs"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS audit_logs_immutable()`);
    await queryRunner.query(
      `ALTER TABLE "user_terms_acceptances" DROP CONSTRAINT "FK_d3dfc323c3963a0414230da3025"`,
    );
    await queryRunner.query(
      `ALTER TABLE "documents" DROP CONSTRAINT "FK_6badfe35ef25ec8ff1cd337c7cf"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_d3dfc323c3963a0414230da302"`);
    await queryRunner.query(`DROP TABLE "user_terms_acceptances"`);
    await queryRunner.query(`DROP TABLE "settings"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_d7f225a1bd33741a7751c8a5c1"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_affc3911eff37e11869f2fbd3b"`);
    await queryRunner.query(`DROP TABLE "documents"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_97672ac88f789774dd47f7c8be"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cf035c59c611eef2ca6eb1dfdd"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_7421efc125d95e413657efa3c6"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_36cd4615fabad14abad075ffc9"`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);
  }
}
```

```ts
// src/migrations/1791414493019-AddProjects.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjects1791414493019 implements MigrationInterface {
  name = 'AddProjects1791414493019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "projects" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "code" character varying(20) NOT NULL, "name" character varying(160) NOT NULL, "budget" numeric(14,2), "status" character varying(20) NOT NULL DEFAULT 'draft', "metadata" jsonb NOT NULL DEFAULT '{}', "starts_on" date, "owner_sub" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "version" integer NOT NULL DEFAULT '1', CONSTRAINT "CHK_e3c0ee580426db9429c41d8f0e" CHECK ("status" IN ('draft','active','closed')), CONSTRAINT "PK_6271df0a7aed1d6c0691ce6ac50" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a27865a7be17886e3088f4a650" ON "projects"  ("status") `,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_projects_code" ON "projects"  ("code") `);
    await queryRunner.query(
      `ALTER TABLE "projects" ADD CONSTRAINT "FK_bdab9cfaeebc84b34ca4c6d24ec" FOREIGN KEY ("owner_sub") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "projects" DROP CONSTRAINT "FK_bdab9cfaeebc84b34ca4c6d24ec"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_projects_code"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_a27865a7be17886e3088f4a650"`);
    await queryRunner.query(`DROP TABLE "projects"`);
  }
}
```

`MIGRATIONS` es un array escrito a mano, en orden. **No hay glob.** esbuild no puede resolver `migrations/*.ts` en tiempo de ejecución, y un glob que funciona con el CLI en local y no dentro de la Lambda es exactamente el fallo que esta lista evita. Cada migración nueva se importa aquí. El nombre de la clase tiene que sobrevivir a la minificación (`keepNames`, 6.11): TypeORM decide cuál está aplicada comparando el nombre de la clase con la tabla `migrations`.

La migración `Init` está generada y luego **editada a mano** para añadir el trigger `audit_logs_immutable`, que rechaza `UPDATE`, `DELETE` y `TRUNCATE` sobre `audit_logs`. `migration:generate` no emite triggers. El trigger es la garantía; el `REVOKE` del rol es la segunda. Hace falta las dos: el maestro, que sí puede escribir, también queda frenado por el trigger.

Reglas de una migración nueva:

1. Compatible hacia atrás con el código que **todavía está sirviendo** tráfico. El pipeline aplica migraciones y después publica el código (17.2). Durante esos minutos conviven el esquema nuevo y el código viejo. Añadir una columna `NOT NULL` sin default, renombrar una columna o cambiar un tipo en el mismo paso rompe las peticiones en vuelo.
2. El patrón seguro para un cambio incompatible es expandir y contraer, en **dos** despliegues: primero se añade lo nuevo (el código viejo lo ignora), se publica el código que lo usa, y en un despliegue posterior se retira lo viejo.
3. `migration:generate` se corre contra una base local ya migrada. El SQL se lee entero antes de commitear. Se borran los `DROP` que el diff proponga por una entidad que TypeORM no vio (casi siempre: alguien olvidó añadirla a `entities.ts`).
4. No se edita una migración ya aplicada en algún stage. Se añade otra.

`AddProjects` es del módulo de ejemplo. En el dominio nuevo no se copia: se genera la migración de las entidades reales.

### 11.5 Seeds

```ts
// src/database/seed-data.ts
import type { DataSource } from 'typeorm';
import { Setting } from '../modules/users/setting.entity';

/** Toda clave lleva su descripción: qué consume el valor, de qué tipo es y qué rango admite. */
export const DEFAULT_SETTINGS: Array<Pick<Setting, 'key' | 'value' | 'description'>> = [
  {
    key: 'terms_and_conditions_url',
    value: '<TERMS_URL>',
    description:
      'URL pública de los términos vigentes. La muestra el registro y se guarda como versión aceptada en user_terms_acceptances.',
  },
];

/** Idempotente: inserta las claves que falten y nunca pisa un valor editado. */
export async function seedDefaults(db: DataSource): Promise<number> {
  const result = await db
    .createQueryBuilder()
    .insert()
    .into(Setting)
    .values(DEFAULT_SETTINGS)
    .orIgnore()
    .returning(['key'])
    .execute();
  return (result.raw as unknown[]).length;
}
```

```ts
// src/database/seed.ts
import dataSource from '../config/typeorm.config';
import { seedDefaults } from './seed-data';

/** `pnpm db:seed` en local. En AWS se usa la acción `seed` de la Lambda migrator. */
async function main() {
  await dataSource.initialize();
  try {
    const inserted = await seedDefaults(dataSource);
    process.stdout.write(`Seeds aplicados: ${inserted} claves nuevas.\n`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

`orIgnore()` más `returning(['key'])`: insertar de nuevo no falla y el recuento de "cuántas se insertaron" sale de las filas devueltas, no de un `COUNT(*)` posterior (que siempre daría el total). El migrator expone la acción `seed`. En local, `pnpm db:seed`.

### 11.6 Lambda migrator

```ts
// src/lambda-migrator.ts
import 'reflect-metadata';
import { z } from 'zod';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './config/database.config';
import { ensureAppRole } from './database/db-roles';
import { ENTITIES } from './database/entities';
import { seedDefaults } from './database/seed-data';
import { MIGRATIONS } from './migrations';

const envSchema = z.object({
  STAGE: z.enum(['local', 'test', 'dev', 'qa', 'prod']),
  AWS_REGION: z.string(),
  // En AWS: ARN del secreto del usuario maestro (lo genera y rota RDS/CDK).
  // Trae host, puerto, usuario y contraseña. En local se usan las DB_* sueltas.
  DB_MASTER_SECRET_ARN: z.string().optional(),
  DB_HOST: z.string().optional(),
  DB_PORT: z.coerce.number().default(5432),
  DB_USERNAME: z.string().optional(),
  DB_PASSWORD: z.string().optional(),
  DB_NAME: z.string().min(1),
  DB_SSL: z.stringbool().default(false),
  // true en AWS: app_user recibe rds_iam (IAM-only).
  DB_APP_USER_IAM: z.stringbool().default(false),
  COGNITO_USER_POOL_ID: z.string().optional(),
});

type MigratorEnv = z.infer<typeof envSchema>;

/**
 * Credenciales del usuario maestro. Se leen en CADA invocación: Secrets
 * Manager las rota cada 30 días y una copia en caché quedaría obsoleta.
 * El migrator entra DIRECTO a la instancia (no por el proxy, que solo admite
 * IAM), con TLS validado contra los CA de Amazon (NODE_EXTRA_CA_CERTS, 16.7).
 */
async function masterCredentials(env: MigratorEnv) {
  if (!env.DB_MASTER_SECRET_ARN) {
    if (!env.DB_HOST || !env.DB_USERNAME) throw new Error('Faltan DB_HOST/DB_USERNAME');
    return {
      host: env.DB_HOST,
      port: env.DB_PORT,
      username: env.DB_USERNAME,
      password: env.DB_PASSWORD,
    };
  }
  const { SecretsManagerClient, GetSecretValueCommand } =
    await import('@aws-sdk/client-secrets-manager');
  const res = await new SecretsManagerClient({ region: env.AWS_REGION }).send(
    new GetSecretValueCommand({ SecretId: env.DB_MASTER_SECRET_ARN }),
  );
  const s = JSON.parse(res.SecretString ?? '{}') as {
    host: string;
    port: number;
    username: string;
    password: string;
  };
  return { host: s.host, port: Number(s.port), username: s.username, password: s.password };
}

const eventSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('migrate') }),
  z.object({ action: z.literal('status') }),
  z.object({ action: z.literal('seed') }),
  z.object({ action: z.literal('revert'), confirm: z.literal('REVERT_ONE') }),
  z.object({
    action: z.literal('create-admin'),
    email: z.email().transform((v) => v.toLowerCase()),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
  }),
]);

type CreateAdminEvent = Extract<z.infer<typeof eventSchema>, { action: 'create-admin' }>;

/**
 * Alta de un administrador: Cognito le envía una invitación con contraseña
 * temporal (al entrar resolverá NEW_PASSWORD_REQUIRED y MFA_SETUP), se le
 * añade al grupo admin y se crea su fila local. Idempotente por email.
 */
async function createAdmin(db: DataSource, poolId: string, region: string, e: CreateAdminEvent) {
  const cognito = await import('@aws-sdk/client-cognito-identity-provider');
  const client = new cognito.CognitoIdentityProviderClient({ region });
  let sub: string | undefined;
  try {
    const res = await client.send(
      new cognito.AdminCreateUserCommand({
        UserPoolId: poolId,
        Username: e.email,
        DesiredDeliveryMediums: ['EMAIL'],
        UserAttributes: [
          { Name: 'email', Value: e.email },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'given_name', Value: e.firstName },
          { Name: 'family_name', Value: e.lastName },
        ],
      }),
    );
    sub = res.User?.Attributes?.find((a) => a.Name === 'sub')?.Value;
  } catch (error) {
    if ((error as { name?: string }).name !== 'UsernameExistsException') throw error;
    const res = await client.send(
      new cognito.AdminGetUserCommand({ UserPoolId: poolId, Username: e.email }),
    );
    sub = res.UserAttributes?.find((a) => a.Name === 'sub')?.Value;
  }
  if (!sub) throw new Error('Cognito no devolvió el sub del usuario');
  await client.send(
    new cognito.AdminAddUserToGroupCommand({
      UserPoolId: poolId,
      Username: e.email,
      GroupName: '<ROL_B>',
    }),
  );
  await db.query(
    `INSERT INTO users (id, email, first_name, last_name, cognito_status, user_status)
     VALUES ($1, $2, $3, $4, 'confirmed', 'active')
     ON CONFLICT (id) DO NOTHING`,
    [sub, e.email, e.firstName, e.lastName],
  );
  return sub;
}

/**
 * Lambda de operaciones de base de datos. La invoca el CI (17.4), nunca un
 * usuario, y vive en la VPC porque la base no es accesible desde internet.
 * Conecta como usuario maestro: es el ÚNICO componente con permisos DDL.
 */
export const handler = async (rawEvent: unknown) => {
  const env = envSchema.parse(process.env);
  const event = eventSchema.parse(rawEvent);
  const creds = await masterCredentials(env);
  const db = new DataSource({
    ...buildDataSourceOptions({
      DB_HOST: creds.host,
      DB_PORT: creds.port,
      DB_USERNAME: creds.username,
      DB_PASSWORD: creds.password,
      DB_NAME: env.DB_NAME,
      DB_IAM_AUTH: false,
      DB_SSL: env.DB_SSL,
      DB_POOL_MAX: 1,
      AWS_REGION: env.AWS_REGION,
      STAGE: env.STAGE,
    }),
    entities: ENTITIES,
    migrations: MIGRATIONS,
  });
  await db.initialize();
  try {
    switch (event.action) {
      case 'status': {
        const pending = await db.showMigrations();
        return { ok: true, pending };
      }
      case 'migrate': {
        const applied = await db.runMigrations({ transaction: 'each' });
        await ensureAppRole(db, { iam: env.DB_APP_USER_IAM, database: env.DB_NAME });
        return { ok: true, applied: applied.map((m) => m.name) };
      }
      case 'seed': {
        // Solo inserta claves de `settings` que falten. Nunca datos de prueba: es seguro en prod.
        const inserted = await seedDefaults(db);
        return { ok: true, inserted };
      }
      case 'create-admin': {
        if (!env.COGNITO_USER_POOL_ID) throw new Error('COGNITO_USER_POOL_ID no está configurado');
        const sub = await createAdmin(db, env.COGNITO_USER_POOL_ID, env.AWS_REGION, event);
        return { ok: true, sub };
      }
      case 'revert': {
        await db.undoLastMigration({ transaction: 'each' });
        return { ok: true, reverted: 1 };
      }
    }
  } finally {
    await db.destroy();
  }
};
```

Acciones del evento `{ "action": "..." }`:

| Acción | Efecto | Guardia |
|---|---|---|
| `migrate` | `ensureAppRole` y `runMigrations` | ninguna: es idempotente |
| `status` | lista migraciones pendientes | ninguna |
| `seed` | claves de `settings` que falten | ninguna |
| `revert` | revierte **una** migración | el evento tiene que traer `confirm: "REVERT_ONE"` |
| `create-admin` | `AdminCreateUser` + grupo `<ROL_B>` + fila local | idempotente: si el usuario ya existe, no lo recrea ni le pisa el estado |

`create-admin` es el alta del primer administrador, cuando el self-signup está cerrado o cuando hace falta un usuario antes de que nadie pueda entrar. El evento lleva `email`, `name` y una contraseña temporal que Cognito obliga a cambiar (`NEW_PASSWORD_REQUIRED`, que el flujo de retos de la sección 10 ya sabe completar).

La contraseña del maestro se lee **en cada invocación**. Cachearla en el entorno caliente deja la Lambda rota el día que RDS rota el secreto (cada 30 días) hasta el siguiente cold start.

---
## 12. Anatomía de un módulo de feature

🆕 **V2 — plantilla.** El recurso `projects` no es del dominio nuevo: es el módulo de referencia, compilado y cubierto por la suite, que enseña la forma. Al implementar el dominio se **sustituye esta carpeta** por los módulos reales y se conserva todo lo demás: DTO con class-validator, paginación, búsqueda con comodines escapados, 409 ante `23505`, bloqueo optimista, auditoría del antes/después en la misma transacción, y `@Roles` en la clase con una excepción de administrador donde haga falta.

### 12.1 Forma de la carpeta

```
src/modules/<feature>/
├── <feature>.entity.ts
├── <feature>.service.ts
├── <feature>.controller.ts
├── <feature>.module.ts
└── dto/<feature>.dto.ts
```

El módulo se registra en `app.module.ts` y la entidad en `src/database/entities.ts`. Sin los dos, no existe.

### 12.2 El ejemplo

```ts
// src/modules/projects/project.entity.ts
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

/** Estados: varchar + constante, nunca ENUM de PostgreSQL (11.1). */
export const PROJECT_STATUS = { DRAFT: 'draft', ACTIVE: 'active', CLOSED: 'closed' } as const;
export type ProjectStatus = (typeof PROJECT_STATUS)[keyof typeof PROJECT_STATUS];

@Entity('projects')
@Check(`"status" IN ('draft','active','closed')`)
@Index('UQ_projects_code', ['code'], { unique: true })
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Clave natural de negocio. Única: el 409 lo garantiza la base, no una consulta previa. */
  @Column({ type: 'varchar', length: 20 })
  code: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  /** Dinero: numeric(14,2) en la base, string en TS (11.1). */
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  budget: string | null;

  @Index()
  @Column({ type: 'varchar', length: 20, default: PROJECT_STATUS.DRAFT })
  status: ProjectStatus;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  /** Fecha de calendario sin hora: date + string (11.1). */
  @Column({ type: 'date', nullable: true })
  startsOn: string | null;

  @Column({ type: 'uuid', nullable: true })
  ownerSub: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'owner_sub' })
  owner: User | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  @VersionColumn({ default: 1 })
  version: number;
}
```

```ts
// src/modules/projects/dto/project.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumberString,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';
import { PROJECT_STATUS, type ProjectStatus } from '../project.entity';

const STATUSES = Object.values(PROJECT_STATUS);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateProjectDto {
  @ApiProperty({ example: 'PRJ-00042' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]{3}-\d{5}$/, { message: 'El código debe tener el formato XXX-00000.' })
  code: string;

  @ApiProperty({ example: 'Implementación ERP' })
  @Transform(trim)
  @IsString()
  @Length(1, 160)
  name: string;

  @ApiPropertyOptional({
    example: '15000.50',
    description: 'Monto como string para no perder precisión',
  })
  @IsOptional()
  @IsNumberString({ no_symbols: false }, { message: 'El presupuesto debe ser un número decimal.' })
  @MaxLength(17)
  budget?: string;

  @ApiPropertyOptional({ example: '2026-11-01', description: 'Fecha YYYY-MM-DD' })
  @IsOptional()
  @IsDateString({ strict: true })
  startsOn?: string;
}

export class UpdateProjectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 160)
  name?: string;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: ProjectStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumberString()
  @MaxLength(17)
  budget?: string;

  /** Versión que el cliente leyó. Si otro usuario guardó antes, la API responde 409. */
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number;
}

export class QueryProjectsDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: ProjectStatus;

  @ApiPropertyOptional({ description: 'Busca en código y nombre' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  q?: string;
}

/** Respuesta pública: nunca se devuelve la entidad cruda (12.1). */
export class ProjectDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) budget: string | null;
  @ApiProperty({ enum: STATUSES }) status: ProjectStatus;
  @ApiProperty({ nullable: true, type: String }) startsOn: string | null;
  @ApiProperty() version: number;
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
}
```

```ts
// src/modules/projects/projects.service.ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Brackets, type DataSource, type Repository } from 'typeorm';
import { AUDIT_ACTIONS } from '../../common/constants/audit-actions';
import { isUniqueViolation } from '../../common/database/pg-errors';
import { type PageDto, toPage } from '../../common/pagination/page';
import { AuditService } from '../audit/audit.service';
import type { ActorContext } from '../users/users.service';
import type {
  CreateProjectDto,
  ProjectDto,
  QueryProjectsDto,
  UpdateProjectDto,
} from './dto/project.dto';
import { Project, PROJECT_STATUS } from './project.entity';

const AUDITED_FIELDS = ['name', 'status', 'budget'] as const;

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project) private readonly repo: Repository<Project>,
    @InjectDataSource() private readonly db: DataSource,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateProjectDto, actor: ActorContext): Promise<ProjectDto> {
    try {
      return await this.db.transaction(async (m) => {
        const repo = m.getRepository(Project);
        // El id lo genera la base: save() hace un INSERT (nunca un UPDATE de otra fila).
        const project = await repo.save(
          repo.create({
            code: dto.code,
            name: dto.name,
            budget: dto.budget ?? null,
            startsOn: dto.startsOn ?? null,
            status: PROJECT_STATUS.DRAFT,
            ownerSub: actor.actorSub,
          }),
        );
        await this.audit.record(
          {
            action: AUDIT_ACTIONS.PROJECT_CREATED,
            actorSub: actor.actorSub,
            ip: actor.ip,
            requestId: actor.requestId,
            entityType: 'project',
            entityId: project.id,
            after: pick(project),
          },
          m,
        );
        return toDto(project);
      });
    } catch (error) {
      if (isUniqueViolation(error, 'UQ_projects_code')) {
        throw new ConflictException(`Ya existe un proyecto con el código ${dto.code}.`);
      }
      throw error;
    }
  }

  async findById(id: string): Promise<ProjectDto> {
    const project = await this.repo.findOneBy({ id });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
    return toDto(project);
  }

  async list(q: QueryProjectsDto): Promise<PageDto<ProjectDto>> {
    const qb = this.repo
      .createQueryBuilder('p')
      .orderBy('p.createdAt', 'DESC')
      .addOrderBy('p.id', 'ASC');
    if (q.status) qb.andWhere('p.status = :status', { status: q.status });
    if (q.q) {
      qb.andWhere(
        new Brackets((w) =>
          w.where('p.code ILIKE :q', { q: `%${escapeLike(q.q!)}%` }).orWhere('p.name ILIKE :q'),
        ),
      );
    }
    const [rows, total] = await qb.take(q.limit).skip(q.offset).getManyAndCount();
    return toPage(rows.map(toDto), total, q);
  }

  /**
   * Bloqueo optimista: el UPDATE solo afecta a la fila si su versión sigue
   * siendo la que leyó el cliente. Si otro usuario guardó antes, 0 filas → 409.
   */
  async update(id: string, dto: UpdateProjectDto, actor: ActorContext): Promise<ProjectDto> {
    return this.db.transaction(async (m) => {
      const repo = m.getRepository(Project);
      const current = await repo.findOneBy({ id });
      if (!current) throw new NotFoundException('Proyecto no encontrado.');
      const changes: Partial<Pick<Project, 'name' | 'status' | 'budget'>> = {};
      if (dto.name !== undefined) changes.name = dto.name;
      if (dto.status !== undefined) changes.status = dto.status;
      if (dto.budget !== undefined) changes.budget = dto.budget;

      const result = await repo
        .createQueryBuilder()
        .update(Project)
        .set({ ...changes, version: () => 'version + 1' })
        .where('id = :id AND version = :version', { id, version: dto.version })
        .execute();
      if (result.affected === 0) {
        throw new ConflictException(
          'Otro usuario modificó este proyecto. Recarga y vuelve a intentarlo.',
        );
      }
      const updated = await repo.findOneByOrFail({ id });
      await this.audit.record(
        {
          action: AUDIT_ACTIONS.PROJECT_UPDATED,
          actorSub: actor.actorSub,
          ip: actor.ip,
          requestId: actor.requestId,
          entityType: 'project',
          entityId: id,
          before: pick(current),
          after: pick(updated),
        },
        m,
      );
      return toDto(updated);
    });
  }
}

function toDto(p: Project): ProjectDto {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    budget: p.budget,
    status: p.status,
    startsOn: p.startsOn,
    version: p.version,
    updatedAt: (p.updatedAt ?? new Date()).toISOString(),
  };
}

function pick(p: Project): Record<string, unknown> {
  return Object.fromEntries(AUDITED_FIELDS.map((k) => [k, p[k] ?? null]));
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
```

```ts
// src/modules/projects/projects.controller.ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type CurrentUserPayload } from '../../common/auth/current-user';
import { ADMIN_ROLE, Roles } from '../../common/auth/roles';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { ApiPageResponse } from '../../common/pagination/page';
import {
  CreateProjectDto,
  ProjectDto,
  QueryProjectsDto,
  UpdateProjectDto,
} from './dto/project.dto';
import { ProjectsService } from './projects.service';

@ApiTags('Proyectos')
@Controller('projects')
// Default de la clase: cualquier método puede sobrescribirlo con su propio @Roles.
@Roles('<ROL_A>', ADMIN_ROLE)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar proyectos (paginado, con filtro y búsqueda)' })
  @ApiPageResponse(ProjectDto)
  list(@Query() q: QueryProjectsDto) {
    return this.projects.list(q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un proyecto' })
  @ApiOkResponse({ type: ProjectDto })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.findById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Crear un proyecto' })
  @ApiCreatedResponse({ type: ProjectDto })
  create(
    @Body() dto: CreateProjectDto,
    @CurrentUser() user: CurrentUserPayload,
    @ReqCtx() ctx: RequestContext,
  ) {
    return this.projects.create(dto, { actorSub: user.sub, ip: ctx.ip, requestId: ctx.requestId });
  }

  @Patch(':id')
  @Roles(ADMIN_ROLE)
  @ApiOperation({ summary: 'Editar un proyecto (admin). Exige la versión leída: 409 si cambió' })
  @ApiOkResponse({ type: ProjectDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: CurrentUserPayload,
    @ReqCtx() ctx: RequestContext,
  ) {
    return this.projects.update(id, dto, {
      actorSub: user.sub,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
  }
}
```

```ts
// src/modules/projects/projects.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { Project } from './project.entity';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [TypeOrmModule.forFeature([Project]), AuditModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
```

Puntos que se copian aunque el recurso se llame de otra forma:

- **`insert` contra `save`.** Aquí el id lo genera la base, así que `save()` es correcto: no hay una clave que pueda coincidir con otra fila. Cuando el id lo pone el cliente (como `users.id` = sub), se usa `insert()` (10.6).
- **La violación de unicidad se traduce.** `UQ_projects_code` → 409 con un mensaje de negocio. El resto de los errores de base se propagan y el filtro los convierte en 500 sin SQL en el cuerpo.
- **La búsqueda escapa `%`, `_` y `\`** antes de armar el `ILIKE`. Si no, un usuario que escribe `%` lista toda la tabla.
- **El `UPDATE` optimista** es `WHERE id = :id AND version = :version`. Cero filas afectadas es 409, no un reintento silencioso. El cliente relee y reintenta si quiere.
- **La auditoría va dentro de la transacción** del cambio. Si el insert de `audit_logs` falla, el cambio también. `before`/`after` son los campos que importan, no un `SELECT *` volcado a JSON.
- **`@Roles('<ROL_A>', '<ROL_B>')` en la clase** y `@Roles('<ROL_B>')` en el método que es solo de administración. El guard de método pisa al de clase. No hace falta repetir `@UseGuards`: los guards son globales (22.21).

### 12.3 Qué no se copia de un CRUD genérico

- No hay `DELETE`. Desactivar es un cambio de estado auditado.
- No hay `findOneById` ni `Connection`: no existen en TypeORM 1.1. La búsqueda es `findOneBy({ id })` y las transacciones son `dataSource.transaction`.
- No se pasa `null` o `undefined` dentro de un `where` "para ignorar el filtro": TypeORM 1.1 lanza. El filtro opcional se omite del objeto.

---
## 13. Documentos y S3

🆕 **V2.** El navegador sube el archivo **directo a S3** con una URL prefirmada. La API no ve los bytes en producción (sí en local, donde no hay bucket). Entre la subida y el procesamiento pasa un antivirus.

### 13.1 Estados

`pending_upload` → `scanning` → `processing` → `processed`

Desde `scanning` o `processing` se puede ir a `failed` (error recuperable: el mensaje queda en la fila) o a `quarantined` (GuardDuty marcó malware). Un objeto en cuarentena no se descarga y no cuenta para la unicidad `(entityId, documentType, sha256)`.

La unicidad es un índice parcial `WHERE status <> 'quarantined'`. Dos subidas concurrentes del mismo archivo no pueden crear dos filas válidas (22.14): la pierde el `INSERT`, no un `SELECT` previo.

### 13.2 Contrato

| Método | Ruta | Quién | Qué hace |
|---|---|---|---|
| `POST` | `/api/documents/uploads` | sesión | Crea la fila en `pending_upload` y devuelve la URL prefirmada, las cabeceras que hay que enviar y la caducidad (300 s) |
| `PUT` | `/api/documents/:id/content` | sesión, **solo local** | Recibe el binario, comprueba tamaño y sha256, simula un escaneo limpio |
| `GET` | `/api/documents` | sesión | Lista por `entityId` |
| `GET` | `/api/documents/:id/download` | sesión | URL prefirmada de descarga de 60 s, auditada |

`POST /uploads` exige `contentType` permitido (en el núcleo, solo `application/pdf`), `sizeBytes` ≤ 20 MiB y `sha256` en hexadecimal de 64 caracteres. Los tipos de documento son `<DOC_TIPO_1>`, `<DOC_TIPO_2>`, `<DOC_TIPO_3>` (Anexo A). Hasta que existan, el DTO trae tres slugs de ejemplo que se sustituyen.

### 13.3 La URL prefirmada

El PUT del navegador tiene que mandar, tal cual se firmaron:

- `Content-Type`
- `Content-Length`
- `x-amz-checksum-sha256` (el sha256 en base64, no en hex)

Esas cabeceras van en `signableHeaders` y `x-amz-checksum-sha256` además en `unhoistableHeaders`. Si el SDK la "hoistea" al query string, el navegador no la envía como cabecera y la firma no cuadra. El cliente S3 está creado con `requestChecksumCalculation: 'WHEN_REQUIRED'` (7.5); si no, el SDK mete un CRC32 que la firma no espera.

Verificado el 07/10/2026: la URL generada trae `X-Amz-SignedHeaders=content-length;content-type;host;x-amz-checksum-sha256`, `X-Amz-Expires=300` y no contiene `crc32`.

La clave del objeto es `incoming/<documentId>`. El bucket no es público. El worker la mueve de sitio lógico cambiando el estado, no hace falta reescribir el objeto para marcarlo.

### 13.4 Del bucket al worker

En AWS la cadena es:

1. El navegador hace `PUT` a `incoming/<id>`.
2. GuardDuty Malware Protection for S3 etiqueta el objeto y publica en EventBridge el evento `GuardDuty Malware Protection Object Scan Result`.
3. Una regla de EventBridge entrega a la cola SQS `<app-short>-<stage>-ingest`. Visibilidad 90 min (un procesamiento lento no debe devolver el mensaje mientras sigue en curso), DLQ tras 3 recepciones, alarma sobre la DLQ (16.6).
4. La Lambda `ingest-worker` consume por lote, con `batchItemFailures`: solo se reintenta el mensaje que falló.

El resultado `NO_THREATS_FOUND` pasa la fila a `processing` y llama al procesador de dominio. Cualquier otro resultado (`THREATS_FOUND` y los estados de error del escaneo) deja la fila en `quarantined` y no llama al procesador.

El procesador de dominio del núcleo es un stub que devuelve OK: el dominio nuevo lo sustituye (parseo, validación de negocio). Tiene que ser idempotente: un reintento de SQS puede entregar el mismo mensaje dos veces. La fila ya en `processed` se reconoce y se sale sin repetir el efecto.

La clave del evento llega URL-encoded (`incoming/a%20b`). Se decodifica antes de buscar (22.17).

En local no hay GuardDuty. `PUT /content` verifica tamaño y hash y llama al mismo procesador con un resultado limpio. La suite cubre ese camino y, por separado, `processScanResult` con un evento sintético.

### 13.5 Código

```ts
// src/modules/documents/dto/document.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';
import { DOCUMENT_STATUS, type DocumentStatus } from '../document.entity';

/** 🟦 Tipos de documento del dominio. Sustituir por los reales (<DOC_TIPO_n>). */
export const DOCUMENT_TYPES = ['<DOC_TIPO_1>', '<DOC_TIPO_2>', '<DOC_TIPO_3>'] as const;
export const ALLOWED_CONTENT_TYPES = ['application/pdf'] as const;
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export class CreateUploadDto {
  @ApiProperty({ example: '20123456789', description: '<ENTITY_ID> dueño del documento' })
  @Matches(/^[A-Za-z0-9-]{1,64}$/)
  entityId: string;

  @ApiProperty({ enum: DOCUMENT_TYPES })
  @IsIn(DOCUMENT_TYPES)
  documentType: (typeof DOCUMENT_TYPES)[number];

  @ApiProperty({ example: 'Estado financiero 2026.pdf' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 255)
  filename: string;

  @ApiProperty({ enum: ALLOWED_CONTENT_TYPES })
  @IsIn(ALLOWED_CONTENT_TYPES, { message: 'Solo se aceptan archivos PDF.' })
  contentType: (typeof ALLOWED_CONTENT_TYPES)[number];

  @ApiProperty({ example: 482133, maximum: MAX_DOCUMENT_BYTES })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_DOCUMENT_BYTES, { message: 'El archivo supera el tamaño máximo de 20 MB.' })
  sizeBytes: number;

  @ApiProperty({
    description: 'SHA-256 del archivo en hexadecimal (64 caracteres), calculado en el navegador',
  })
  @Matches(/^[a-f0-9]{64}$/, { message: 'sha256 debe ser hexadecimal de 64 caracteres.' })
  sha256: string;
}

export class UploadIntentDto {
  @ApiProperty({ format: 'uuid' }) documentId: string;
  @ApiProperty({ enum: ['upload', 'duplicate'] }) result: 'upload' | 'duplicate';
  @ApiPropertyOptional({ description: 'URL presignada (PUT). Caduca en 5 minutos' })
  uploadUrl?: string;
  @ApiPropertyOptional({
    description: 'Cabeceras que el PUT DEBE enviar tal cual (forman parte de la firma)',
  })
  headers?: Record<string, string>;
}

export class DocumentDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() entityId: string;
  @ApiProperty() documentType: string;
  @ApiProperty() filename: string;
  @ApiProperty({ enum: Object.values(DOCUMENT_STATUS) }) status: DocumentStatus;
  @ApiProperty() sizeBytes: number;
  @ApiProperty({ nullable: true, type: String }) errorMessage: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

export class QueryDocumentsDto extends PageQueryDto {
  @ApiProperty({ example: '20123456789' })
  @Matches(/^[A-Za-z0-9-]{1,64}$/)
  entityId: string;
}
```

```ts
// src/modules/documents/documents.service.ts
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import type { DataSource, Repository } from 'typeorm';
import { AUDIT_ACTIONS } from '../../common/constants/audit-actions';
import { isUniqueViolation } from '../../common/database/pg-errors';
import { type PageDto, toPage } from '../../common/pagination/page';
import {
  getS3Client,
  localUploadPath,
  shouldUseLocalDocumentStorage,
} from '../../config/aws-s3.client';
import type { EnvConfig } from '../../config/env.validation';
import { AuditService } from '../audit/audit.service';
import type { ActorContext } from '../users/users.service';
import { Document, DOCUMENT_STATUS } from './document.entity';
import type {
  CreateUploadDto,
  DocumentDto,
  QueryDocumentsDto,
  UploadIntentDto,
} from './dto/document.dto';
import { processScanResult } from './ingest.processor';

const UPLOAD_URL_TTL_SECONDS = 300;
const DOWNLOAD_URL_TTL_SECONDS = 60;
/** incoming/<entityId>/<tipo>/<documentId>.pdf — el nombre original NUNCA forma parte de la clave. */
export const incomingKey = (entityId: string, type: string, id: string) =>
  `incoming/${entityId}/${type}/${id}.pdf`;

@Injectable()
export class DocumentsService {
  private readonly bucket: string;
  readonly localMode = shouldUseLocalDocumentStorage();

  constructor(
    @InjectRepository(Document) private readonly repo: Repository<Document>,
    @InjectDataSource() private readonly db: DataSource,
    private readonly audit: AuditService,
    config: ConfigService<EnvConfig, true>,
  ) {
    this.bucket = config.get('DOCS_BUCKET', { infer: true });
  }

  /**
   * Paso 1 de la subida: registra el documento y devuelve una URL presignada.
   * La firma incluye Content-Type, Content-Length y el checksum SHA-256: S3
   * rechaza un archivo distinto, de otro tamaño o de otro tipo al declarado.
   */
  async createUpload(dto: CreateUploadDto, actor: ActorContext): Promise<UploadIntentDto> {
    const id = randomUUID();
    const s3Key = incomingKey(dto.entityId, dto.documentType, id);
    try {
      await this.repo.insert({
        id,
        entityId: dto.entityId,
        documentType: dto.documentType,
        filename: dto.filename,
        contentType: dto.contentType,
        sizeBytes: dto.sizeBytes,
        sha256: dto.sha256,
        s3Key,
        status: DOCUMENT_STATUS.PENDING_UPLOAD,
        uploadedBySub: actor.actorSub,
      });
    } catch (error) {
      // Mismo contenido ya subido para esa entidad y tipo: no se duplica (índice único parcial).
      if (isUniqueViolation(error)) {
        const existing = await this.repo.findOneByOrFail({
          entityId: dto.entityId,
          documentType: dto.documentType,
          sha256: dto.sha256,
        });
        return { documentId: existing.id, result: 'duplicate' };
      }
      throw error;
    }
    await this.audit.recordSafe({
      action: AUDIT_ACTIONS.GENERATE_PRESIGNED_URL,
      actorSub: actor.actorSub,
      ip: actor.ip,
      requestId: actor.requestId,
      entityType: 'document',
      entityId: id,
    });

    if (this.localMode) {
      return {
        documentId: id,
        result: 'upload',
        uploadUrl: `/api/documents/${id}/content`,
        headers: { 'content-type': dto.contentType },
      };
    }
    const { url, headers } = await presignUpload(this.bucket, s3Key, dto);
    return { documentId: id, result: 'upload', uploadUrl: url, headers };
  }

  /**
   * Solo en desarrollo local sin AWS: recibe el binario, verifica tamaño y hash,
   * lo guarda en .local-uploads/ y simula un escaneo limpio del antivirus.
   */
  async receiveLocalContent(id: string, body: Buffer): Promise<DocumentDto> {
    if (!this.localMode) throw new NotFoundException();
    const doc = await this.repo.findOneBy({ id });
    if (!doc || doc.status !== DOCUMENT_STATUS.PENDING_UPLOAD)
      throw new NotFoundException('Documento no encontrado.');
    if (
      body.length !== doc.sizeBytes ||
      createHash('sha256').update(body).digest('hex') !== doc.sha256
    ) {
      throw new BadRequestException('El archivo no coincide con el tamaño o el hash declarados.');
    }
    const path = localUploadPath(doc.s3Key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    await processScanResult(
      {
        'detail-type': 'GuardDuty Malware Protection Object Scan Result',
        detail: {
          scanStatus: 'COMPLETED',
          s3ObjectDetails: { bucketName: 'local', objectKey: doc.s3Key },
          scanResultDetails: { scanResultStatus: 'NO_THREATS_FOUND' },
        },
      },
      {
        db: this.db,
        s3: { move: () => Promise.resolve() },
        process: () => Promise.resolve({ validationStatus: 'OK' }),
        parserVersion: 'local',
      },
    );
    return toDto(await this.repo.findOneByOrFail({ id }));
  }

  async list(q: QueryDocumentsDto): Promise<PageDto<DocumentDto>> {
    const [rows, total] = await this.repo.findAndCount({
      where: { entityId: q.entityId },
      order: { createdAt: 'DESC' },
      take: q.limit,
      skip: q.offset,
    });
    return toPage(rows.map(toDto), total, q);
  }

  /** URL de descarga de 60 s. Solo documentos procesados, y queda auditada. */
  async downloadUrl(id: string, actor: ActorContext): Promise<{ url: string }> {
    const doc = await this.repo.findOneBy({ id });
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    if (doc.status !== DOCUMENT_STATUS.PROCESSED) {
      throw new ConflictException('El documento todavía no está disponible.');
    }
    await this.audit.record({
      action: AUDIT_ACTIONS.DOWNLOAD_DOCUMENT,
      actorSub: actor.actorSub,
      ip: actor.ip,
      requestId: actor.requestId,
      entityType: 'document',
      entityId: id,
    });
    if (this.localMode) return { url: `file://${localUploadPath(doc.s3Key)}` };
    const safeName = doc.filename.replace(/[^\w.\- ]/g, '_');
    const url = await getSignedUrl(
      getS3Client(),
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: doc.s3Key,
        ResponseContentDisposition: `attachment; filename="${safeName}"`,
      }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
    );
    return { url };
  }
}

/**
 * URL PUT presignada. Content-Type, Content-Length y x-amz-checksum-sha256 quedan
 * dentro de la firma: el navegador debe enviarlos exactamente con esos valores.
 */
export async function presignUpload(
  bucket: string,
  key: string,
  file: { contentType: string; sizeBytes: number; sha256: string },
): Promise<{ url: string; headers: Record<string, string> }> {
  const checksum = Buffer.from(file.sha256, 'hex').toString('base64');
  const url = await getSignedUrl(
    getS3Client(),
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: file.contentType,
      ContentLength: file.sizeBytes,
      ChecksumSHA256: checksum,
    }),
    {
      expiresIn: UPLOAD_URL_TTL_SECONDS,
      // Por defecto el presigner NO firma content-type: sin esto se podría subir otro tipo de archivo.
      signableHeaders: new Set(['content-type']),
      unhoistableHeaders: new Set(['x-amz-checksum-sha256']),
    },
  );
  return { url, headers: { 'content-type': file.contentType, 'x-amz-checksum-sha256': checksum } };
}

function toDto(d: Document): DocumentDto {
  return {
    id: d.id,
    entityId: d.entityId,
    documentType: d.documentType,
    filename: d.filename,
    status: d.status,
    sizeBytes: d.sizeBytes,
    errorMessage: d.errorMessage,
    createdAt: d.createdAt.toISOString(),
  };
}
```

```ts
// src/modules/documents/documents.controller.ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser, type CurrentUserPayload } from '../../common/auth/current-user';
import { ADMIN_ROLE, Roles } from '../../common/auth/roles';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { ApiPageResponse } from '../../common/pagination/page';
import { DocumentsService } from './documents.service';
import {
  CreateUploadDto,
  DocumentDto,
  QueryDocumentsDto,
  UploadIntentDto,
} from './dto/document.dto';

@ApiTags('Documentos')
@Controller('documents')
@Roles('<ROL_A>', ADMIN_ROLE)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post('uploads')
  @ApiOperation({ summary: 'Registrar una subida y obtener la URL presignada (PUT directo a S3)' })
  @ApiCreatedResponse({ type: UploadIntentDto })
  createUpload(
    @Body() dto: CreateUploadDto,
    @CurrentUser() user: CurrentUserPayload,
    @ReqCtx() ctx: RequestContext,
  ) {
    return this.documents.createUpload(dto, {
      actorSub: user.sub,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
  }

  @Put(':id/content')
  @ApiOperation({
    summary: 'Solo desarrollo local sin AWS: recibe el binario (en AWS el PUT va a S3)',
  })
  @ApiOkResponse({ type: DocumentDto })
  receiveLocal(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.documents.receiveLocalContent(
      id,
      Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
    );
  }

  @Get()
  @ApiOperation({ summary: 'Documentos de una entidad (paginado)' })
  @ApiPageResponse(DocumentDto)
  list(@Query() q: QueryDocumentsDto) {
    return this.documents.list(q);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'URL de descarga (60 s). Queda auditada' })
  download(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserPayload,
    @ReqCtx() ctx: RequestContext,
  ) {
    return this.documents.downloadUrl(id, {
      actorSub: user.sub,
      ip: ctx.ip,
      requestId: ctx.requestId,
    });
  }
}
```

```ts
// src/modules/documents/documents.module.ts
import { type MiddlewareConsumer, Module, type NestModule, RequestMethod } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import express from 'express';
import { AuditModule } from '../audit/audit.module';
import { Document } from './document.entity';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { MAX_DOCUMENT_BYTES } from './dto/document.dto';

@Module({
  imports: [TypeOrmModule.forFeature([Document]), AuditModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule implements NestModule {
  // Cuerpo binario solo en la ruta de subida local; el resto de la API sigue siendo JSON.
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(express.raw({ type: 'application/pdf', limit: MAX_DOCUMENT_BYTES }))
      .forRoutes({ path: 'documents/:id/content', method: RequestMethod.PUT });
  }
}
```

```ts
// src/modules/documents/ingest.processor.ts
import type { DataSource } from 'typeorm';
import { Document, DOCUMENT_STATUS } from './document.entity';

/** Evento "GuardDuty Malware Protection Object Scan Result" (lo que EventBridge deja en SQS). */
export interface ScanResultEvent {
  'detail-type': string;
  detail: {
    scanStatus: 'COMPLETED' | 'SKIPPED' | 'FAILED';
    s3ObjectDetails: { bucketName: string; objectKey: string; versionId?: string };
    scanResultDetails?: { scanResultStatus?: string; threats?: Array<{ name: string }> | null };
  };
}

/** Lo mínimo que el procesador necesita de S3: mover un objeto. Inyectable para tests. */
export interface ObjectMover {
  move(bucket: string, fromKey: string, toKey: string): Promise<void>;
}

/** Procesamiento de dominio de un archivo limpio. Lo implementa cada proyecto (🟦). */
export type DomainProcessor = (
  doc: Document,
  rawKey: string,
) => Promise<{ validationStatus: string }>;

export type IngestOutcome = 'processed' | 'quarantined' | 'failed' | 'skipped';

/**
 * Máquina de estados de 13.5:
 *   pending_upload → scanning → processing → processed
 *                        ├────────────────→ quarantined (amenaza o no escaneable)
 *                        └────────────────→ failed      (error del procesador; reintentable)
 * Idempotente: SQS entrega al menos una vez; un documento que ya salió de
 * `scanning` se ignora.
 */
export async function processScanResult(
  event: ScanResultEvent,
  deps: { db: DataSource; s3: ObjectMover; process: DomainProcessor; parserVersion: string },
): Promise<IngestOutcome> {
  const { bucketName, objectKey } = event.detail.s3ObjectDetails;
  // Las claves de los eventos llegan URL-encoded (22.17).
  const key = decodeURIComponent(objectKey.replace(/\+/g, ' '));
  const repo = deps.db.getRepository(Document);
  const doc = await repo.findOneBy({ s3Key: key });
  if (
    !doc ||
    (doc.status !== DOCUMENT_STATUS.SCANNING && doc.status !== DOCUMENT_STATUS.PENDING_UPLOAD)
  ) {
    return 'skipped';
  }

  const verdict = event.detail.scanResultDetails?.scanResultStatus;
  if (event.detail.scanStatus !== 'COMPLETED' || verdict !== 'NO_THREATS_FOUND') {
    const quarantineKey = key.replace(/^incoming\//, 'quarantine/');
    await deps.s3.move(bucketName, key, quarantineKey);
    await repo.update(doc.id, {
      status: DOCUMENT_STATUS.QUARANTINED,
      s3Key: quarantineKey,
      validationStatus: verdict ?? event.detail.scanStatus,
      errorMessage:
        (event.detail.scanResultDetails?.threats ?? []).map((t) => t.name).join(', ') || null,
    });
    return 'quarantined';
  }

  const rawKey = key.replace(/^incoming\//, 'raw/');
  await deps.s3.move(bucketName, key, rawKey);
  await repo.update(doc.id, { status: DOCUMENT_STATUS.PROCESSING, s3Key: rawKey });
  try {
    const result = await deps.process({ ...doc, s3Key: rawKey }, rawKey);
    await repo.update(doc.id, {
      status: DOCUMENT_STATUS.PROCESSED,
      validationStatus: result.validationStatus,
      parserVersion: deps.parserVersion,
      processedAt: new Date(),
      errorMessage: null,
    });
    return 'processed';
  } catch (error) {
    // Nunca dejar un documento en `processing`: el error queda en la fila para la UI.
    await repo.update(doc.id, {
      status: DOCUMENT_STATUS.FAILED,
      validationStatus: 'PARSER_ERROR',
      errorMessage: String(error instanceof Error ? error.message : error).slice(0, 2000),
    });
    return 'failed';
  }
}
```

```ts
// src/modules/documents/presign.spec.ts
import { describe, expect, it } from 'vitest';
import { presignUpload } from './documents.service';

describe('presignUpload', () => {
  it('firma tipo, tamaño y SHA-256, sin checksum CRC32 por defecto y con caducidad de 5 min', async () => {
    process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
    process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    process.env.AWS_REGION = 'us-east-1';
    const sha256 = 'a'.repeat(64);
    const { url, headers } = await presignUpload('docs', 'incoming/E1/t/x.pdf', {
      contentType: 'application/pdf',
      sizeBytes: 1234,
      sha256,
    });
    const u = new URL(url);
    const signed = u.searchParams.get('X-Amz-SignedHeaders') ?? '';
    expect(signed.split(';')).toEqual(
      expect.arrayContaining(['content-length', 'content-type', 'host', 'x-amz-checksum-sha256']),
    );
    expect(u.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url).not.toMatch(/crc32/i);
    expect(headers['x-amz-checksum-sha256']).toBe(Buffer.from(sha256, 'hex').toString('base64'));
  });
});
```

```ts
// src/lambda-ingest.ts
import 'reflect-metadata';
import type { SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './config/database.config';
import { validateEnv } from './config/env.validation';
import { hydrateSecrets } from './config/hydrate-secrets';
import { ENTITIES } from './database/entities';
import {
  type DomainProcessor,
  type ObjectMover,
  processScanResult,
  type ScanResultEvent,
} from './modules/documents/ingest.processor';

const PARSER_VERSION = '1.0.0';

// 🟦 Sustituir por el procesamiento real del dominio (extracción, validación…).
const processDocument: DomainProcessor = () => Promise.resolve({ validationStatus: 'OK' });

let ready: Promise<{ db: DataSource; s3: ObjectMover }> | undefined;

const log = (entry: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(entry)}\n`);

async function init() {
  await hydrateSecrets();
  const env = validateEnv(process.env);
  const db = new DataSource({
    ...buildDataSourceOptions({ ...env, DB_POOL_MAX: 1 }),
    entities: ENTITIES,
  });
  await db.initialize();
  const { CopyObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  const { getS3Client } = await import('./config/aws-s3.client');
  const client = getS3Client();
  const s3: ObjectMover = {
    async move(bucket, from, to) {
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: to,
          CopySource: `${bucket}/${encodeURIComponent(from)}`,
          MetadataDirective: 'COPY',
          TaggingDirective: 'COPY',
        }),
      );
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: from }));
    },
  };
  return { db, s3 };
}

/**
 * Worker de ingesta. Recibe por SQS (batchSize 1) el resultado del antivirus.
 * Devuelve los mensajes fallidos para que SQS los reintente; tras 3 intentos
 * van a la DLQ y salta la alarma (16.5).
 */
export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  ready ??= init().catch((error: unknown) => {
    ready = undefined;
    throw error;
  });
  const { db, s3 } = await ready;
  const failures: SQSBatchResponse['batchItemFailures'] = [];
  for (const record of event.Records) {
    try {
      const outcome = await processScanResult(JSON.parse(record.body) as ScanResultEvent, {
        db,
        s3,
        process: processDocument,
        parserVersion: PARSER_VERSION,
      });
      log({ level: 'info', msg: 'ingest', messageId: record.messageId, outcome });
    } catch (error) {
      log({
        level: 'error',
        msg: 'ingest failed',
        messageId: record.messageId,
        err: String(error),
      });
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
};
```

`express.raw()` se aplica solo a `PUT documents/:id/content`. El resto de las rutas siguen con el JSON parser. Hace falta la dependencia directa `express` (pnpm no expone la transitiva) y el tipo `rawBody` que el controlador lee como `Buffer`. Montar `raw()` a nivel global rompe el `ValidationPipe` de todas las rutas JSON (22.3).

---
## 14. Jobs programados (cron Lambda)

🆕 **V2.** El núcleo **no trae un job de dominio**. El original tenía uno (sincronización de tipos de cambio) que es lógica de negocio y no se copia. Esta sección es el patrón para cuando el dominio necesite un cron. El worker de la sección 13 es el ejemplo real, compilado, de una Lambda que no es la API.

### 14.1 Handler

```ts
// src/lambda-<job>.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { JobService } from './modules/<feature>/<job>.service';

let cached: Promise<{ close(): Promise<void>; get(token: unknown): JobService }> | null = null;

async function context() {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  return app;
}

export async function handler(): Promise<{ processed: number }> {
  if (!cached) cached = context();
  try {
    const app = await cached;
    const result = await app.get(JobService).run();
    process.stdout.write(JSON.stringify({ job: '<job>', processed: result.processed }) + '\n');
    return result;
  } catch (err) {
    cached = null;
    throw err;
  }
}
```

Misma regla que `lambda.ts`: si el arranque falla, se tira la promesa cacheada. No se corren migraciones aquí. El log es una línea JSON a stdout (CloudWatch la indexa) con un número, no un "job ok".

Se añade la entrada en `scripts/bundle.mjs`:

```js
'job-<nombre>': 'dist/lambda-<job>.js',
```

### 14.2 Programación en CDK

EventBridge evalúa el cron en **UTC** y usa seis campos. Exactamente uno de `día-del-mes` y `día-de-la-semana` es `?`.

```ts
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';

new Rule(this, 'WeekdayMorning', {
  description: '08:00 America/Lima (UTC-5) de lunes a viernes. EventBridge solo habla UTC.',
  schedule: Schedule.cron({ minute: '0', hour: '13', weekDay: 'MON-FRI' }),
  targets: [new LambdaFunction(fn)],
});
```

La función se define con `lambda-defaults.ts` (mismo VPC, mismo rol de base IAM, memoria y timeout acordes al lote). Un cron de `timeout` 30 s que procesa "todo lo pendiente" va a empezar a fallar; se procesa un lote con tope y el resto espera a la siguiente pasada.

### 14.3 Reglas

1. **Idempotente.** EventBridge puede entregar dos veces. `upsert` por clave natural, o una fila de control con restricción única.
2. **Alarma sobre `Errors`** de esa función, al mismo topic SNS que el resto (24.3). Un cron que falla en silencio no existe.
3. **Un endpoint manual** `@Roles('<ROL_B>')` que llama a `service.run()`, para forzarlo sin esperar al cron y para probarlo.
4. **No hay lista de funciones que actualizar a mano.** CDK publica todas las funciones del stack. El fallo de la v1 (el script de deploy olvidaba el cron) no tiene equivalente aquí.

---
## 15. Testing

🆕 **V2.** Vitest 5 + Supertest + PostgreSQL 17 real. Cognito no se llama: se sustituye el cliente y se firman access tokens con una clave RSA local.

### 15.1 Qué cubre cada nivel

| Comando | Dónde | Contra qué |
|---|---|---|
| `pnpm test` | `src/**/*.spec.ts` | Proceso, sin base. Entorno, entidades (columnas), IP, URL prefirmada |
| `pnpm test:e2e` | `test/**/*.e2e-spec.ts` | PostgreSQL real, app Nest completa, cookies, guards |
| `pnpm test:e2e:cov` | lo mismo, con umbral | El gate de CI |

Medido el 07/10/2026: 10 tests unitarios, 44 e2e, cobertura de líneas 78.22 %, ramas 58.86 %, funciones 85.46 %. Umbrales en `vitest.e2e.config.mts`: líneas 70, funciones 70, ramas 50.

### 15.2 El arnés

```ts
// test/support/test-app.ts
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { vi } from 'vitest';

export const TEST_ENV = {
  NODE_ENV: 'test',
  STAGE: 'test',
  LOG_LEVEL: 'warn',
  APP_ORIGIN: 'http://127.0.0.1:4200',
  AWS_REGION: 'us-east-1',
  DOCS_BUCKET: 'test-bucket',
  COGNITO_USER_POOL_ID: 'us-east-1_TEST12345',
  COGNITO_CLIENT_ID: 'test-client-id',
  COGNITO_CLIENT_SECRET: 'test-client-secret',
  DB_HOST: process.env.DB_HOST ?? 'localhost',
  DB_PORT: process.env.DB_PORT ?? '5432',
  DB_USERNAME: process.env.DB_USERNAME ?? 'postgres',
  DB_PASSWORD: process.env.DB_PASSWORD ?? 'postgres',
  DB_NAME: process.env.DB_NAME_TEST ?? '<app_snake>_test',
  DB_SSL: 'false',
};
Object.assign(process.env, TEST_ENV);

const ISSUER = `https://cognito-idp.${TEST_ENV.AWS_REGION}.amazonaws.com/${TEST_ENV.COGNITO_USER_POOL_ID}`;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

/** Firma un JWT RS256 como lo haría Cognito. `overrides` permite fabricar tokens inválidos. */
export function signAccessToken(
  claims: { sub: string; groups?: string[] } & Record<string, unknown>,
  opts: { alg?: 'RS256' | 'HS256'; expiresIn?: number } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const { groups, ...rest } = claims;
  const payload = {
    iss: ISSUER,
    token_use: 'access',
    client_id: TEST_ENV.COGNITO_CLIENT_ID,
    username: claims.sub,
    iat: now,
    exp: now + (opts.expiresIn ?? 900),
    jti: randomUUID(),
    ...(groups ? { 'cognito:groups': groups } : {}),
    ...rest,
  };
  const enc = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = enc({ alg: opts.alg ?? 'RS256', typ: 'JWT', kid: 'test' });
  const body = enc(payload);
  const signature =
    opts.alg === 'HS256'
      ? Buffer.from('forged').toString('base64url')
      : sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
  return `${head}.${body}.${signature}`;
}

export interface TestContext {
  app: INestApplication;
  db: DataSource;
  cognitoSend: ReturnType<typeof vi.fn>;
}

export async function createTestApp(): Promise<TestContext> {
  const { AppModule } = await import('../../src/app.module');
  const { configureApp } = await import('../../src/configure-app');
  const { COGNITO_CLIENT } = await import('../../src/modules/auth/cognito.provider');
  const { JWT_KEY_PROVIDER } = await import('../../src/modules/auth/jwt-key.provider');
  const { buildDataSourceOptions } = await import('../../src/config/database.config');
  const { ENTITIES } = await import('../../src/database/entities');
  const { MIGRATIONS } = await import('../../src/migrations');

  const db = new DataSource({
    ...buildDataSourceOptions({
      DB_HOST: TEST_ENV.DB_HOST,
      DB_PORT: Number(TEST_ENV.DB_PORT),
      DB_USERNAME: TEST_ENV.DB_USERNAME,
      DB_PASSWORD: TEST_ENV.DB_PASSWORD,
      DB_NAME: TEST_ENV.DB_NAME,
      DB_IAM_AUTH: false,
      DB_SSL: false,
      AWS_REGION: TEST_ENV.AWS_REGION,
      STAGE: 'test',
    }),
    entities: ENTITIES,
    migrations: MIGRATIONS,
    logging: false,
  });
  await db.initialize();
  // dropDatabase() borra tablas pero no funciones ni triggers: se recrea el esquema entero.
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.runMigrations();

  const cognitoSend = vi.fn();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(COGNITO_CLIENT)
    .useValue({ send: cognitoSend })
    .overrideProvider(JWT_KEY_PROVIDER)
    .useValue((_req: unknown, _raw: unknown, done: (e: unknown, key?: string) => void) =>
      done(null, PUBLIC_PEM),
    )
    .compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  return { app, db, cognitoSend };
}

export async function insertUser(
  db: DataSource,
  overrides: Partial<{ id: string; email: string; userStatus: string }> = {},
): Promise<string> {
  const id = overrides.id ?? randomUUID();
  await db.query(
    `INSERT INTO users (id, email, first_name, last_name, cognito_status, user_status)
     VALUES ($1, $2, 'Ana', 'Pérez', 'confirmed', $3)`,
    [id, overrides.email ?? `${id.slice(0, 8)}@ejemplo.com`, overrides.userStatus ?? 'active'],
  );
  return id;
}
```

Cada archivo e2e llama a `createTestApp()`, que:

1. Hace `DROP SCHEMA public CASCADE` y lo recrea. `dropDatabase()` de TypeORM no tira las funciones ni el trigger, y el siguiente `runMigrations` choca con `audit_logs_immutable`.
2. Corre las migraciones y el seed.
3. Sustituye `COGNITO_CLIENT` por un fake con los métodos que el servicio llama, y `JWT_KEY_PROVIDER` por un `JwksClient` de mentira que devuelve la clave pública del par RSA generado en el proceso.
4. `signAccessToken()` firma un access token RS256 con `token_use`, `client_id` e `iss` correctos. Los tests de rechazo construyen tokens a los que les falta uno de los tres.

La base de test es `DB_NAME_TEST` o, por defecto, `<app_snake>_test`. No es la base de desarrollo. En CI el servicio de GitHub Actions se llama `app_test` (el workflow exporta `DB_NAME_TEST=app_test`).

### 15.3 Las suites

```ts
// test/auth.e2e-spec.ts
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, insertUser, signAccessToken, type TestContext } from './support/test-app';

const AT = '<app-short>_at';
const RT = '<app-short>_rt';
const MFA = '<app-short>_mfa';

function cookieHeader(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? (raw as string[]) : raw ? [raw as string] : [];
}
function findCookie(res: request.Response, name: string): string | undefined {
  return cookieHeader(res).find((c) => c.startsWith(`${name}=`));
}

describe('Autenticación y sesión (e2e)', () => {
  let ctx: TestContext;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    ctx = await createTestApp();
    http = request(ctx.app.getHttpServer());
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.destroy();
  });
  beforeEach(() => ctx.cognitoSend.mockReset());

  it('login correcto: emite cookies httpOnly + SameSite=Strict, nunca tokens en el cuerpo, y audita', async () => {
    const sub = await insertUser(ctx.db);
    const accessToken = signAccessToken({ sub });
    ctx.cognitoSend.mockResolvedValueOnce({
      AuthenticationResult: { AccessToken: accessToken, RefreshToken: 'rt-1', ExpiresIn: 900 },
    });

    const res = await http
      .post('/api/auth/login')
      .send({ email: 'Ana@Ejemplo.com', password: 'x' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('authenticated');
    expect(JSON.stringify(res.body)).not.toContain(accessToken);
    expect(findCookie(res, AT)).toMatch(/HttpOnly/);
    expect(findCookie(res, AT)).toMatch(/SameSite=Strict/);
    expect(findCookie(res, RT)).toMatch(/Path=\/api\/auth/);
    const sentEmail = ctx.cognitoSend.mock.calls[0][0].input.AuthParameters.USERNAME;
    expect(sentEmail).toBe('ana@ejemplo.com');
    const audit = await ctx.db.query(
      `SELECT action, actor_sub FROM audit_logs WHERE action='USER_LOGIN'`,
    );
    expect(audit).toContainEqual({ action: 'USER_LOGIN', actor_sub: sub });
  });

  it('login con MFA: devuelve el reto y lo completa con la cookie de reto', async () => {
    const sub = await insertUser(ctx.db);
    ctx.cognitoSend
      .mockResolvedValueOnce({
        ChallengeName: 'SOFTWARE_TOKEN_MFA',
        Session: 'cognito-session',
        ChallengeParameters: { USER_ID_FOR_SRP: sub },
      })
      .mockResolvedValueOnce({
        AuthenticationResult: {
          AccessToken: signAccessToken({ sub }),
          RefreshToken: 'rt',
          ExpiresIn: 900,
        },
      });

    const step1 = await http
      .post('/api/auth/login')
      .send({ email: 'mfa@ejemplo.com', password: 'x' });
    expect(step1.body).toEqual({ status: 'challenge', challenge: 'SOFTWARE_TOKEN_MFA' });
    const mfaCookie = findCookie(step1, MFA)!.split(';')[0];

    const step2 = await http
      .post('/api/auth/challenge')
      .set('Cookie', mfaCookie)
      .send({ challenge: 'SOFTWARE_TOKEN_MFA', code: '123456' });

    expect(step2.status).toBe(200);
    expect(step2.body.status).toBe('authenticated');
    const respond = ctx.cognitoSend.mock.calls[1][0].input;
    expect(respond.ChallengeResponses).toMatchObject({
      USERNAME: sub,
      SOFTWARE_TOKEN_MFA_CODE: '123456',
    });
    expect(respond.Session).toBe('cognito-session');
  });

  it('reto sin cookie de reto → 401', async () => {
    const res = await http
      .post('/api/auth/challenge')
      .send({ challenge: 'SOFTWARE_TOKEN_MFA', code: '123456' });
    expect(res.status).toBe(401);
  });

  it('credenciales incorrectas → 401 genérico (anti-enumeración) y auditoría de fallo', async () => {
    ctx.cognitoSend.mockRejectedValueOnce(
      Object.assign(new Error('x'), { name: 'UserNotFoundException' }),
    );
    const res = await http
      .post('/api/auth/login')
      .send({ email: 'nadie@ejemplo.com', password: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Correo o contraseña incorrectos.');
    expect(res.body.requestId).toBeTruthy();
  });

  it('/auth/me con sesión válida devuelve el perfil local y la expiración', async () => {
    const sub = await insertUser(ctx.db, { email: 'perfil@ejemplo.com' });
    const res = await http
      .get('/api/auth/me')
      .set('Cookie', `${AT}=${signAccessToken({ sub, groups: ['<ROL_A>'] })}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      sub,
      email: 'perfil@ejemplo.com',
      groups: ['<ROL_A>'],
      userStatus: 'active',
    });
    expect(new Date(res.body.sessionExpiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it.each([
    ['usuario bloqueado', { userStatus: 'blocked' }, {}, {}, 'Tu cuenta fue bloqueada'],
    ['ID token en vez de access token', {}, { token_use: 'id' }, {}, 'La sesión no es válida.'],
    ['token de otro App Client', {}, { client_id: 'otro-cliente' }, {}, 'La sesión no es válida.'],
    ['emisor distinto', {}, { iss: 'https://evil.example' }, {}, 'La sesión no es válida.'],
    ['token expirado', {}, {}, { expiresIn: -60 }, 'La sesión expiró.'],
    [
      'algoritmo HS256 (confusión de algoritmo)',
      {},
      {},
      { alg: 'HS256' as const },
      'La sesión no es válida.',
    ],
  ])('rechaza con 401: %s', async (_name, user, claims, opts, message) => {
    const sub = await insertUser(ctx.db, user);
    const res = await http
      .get('/api/auth/me')
      .set('Cookie', `${AT}=${signAccessToken({ sub, ...claims }, opts)}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toContain(message);
  });

  it('usuario válido en Cognito pero inexistente en la base → 401 (falla cerrado)', async () => {
    const res = await http
      .get('/api/auth/me')
      .set('Cookie', `${AT}=${signAccessToken({ sub: '11111111-1111-4111-8111-111111111111' })}`);
    expect(res.status).toBe(401);
  });

  it('RBAC: sin rol admin → 403; con rol admin → 200 y auditoría con antes/después', async () => {
    const target = await insertUser(ctx.db);
    const user = await insertUser(ctx.db);
    const admin = await insertUser(ctx.db);
    const body = { userStatus: 'blocked' };

    const denied = await http
      .patch(`/api/users/${target}/status`)
      .set('Cookie', `${AT}=${signAccessToken({ sub: user, groups: ['<ROL_A>'] })}`)
      .send(body);
    expect(denied.status).toBe(403);

    const ok = await http
      .patch(`/api/users/${target}/status`)
      .set('Cookie', `${AT}=${signAccessToken({ sub: admin, groups: ['<ROL_B>'] })}`)
      .set('x-request-id', 'e2e-rbac-0001')
      .send(body);
    expect(ok.status).toBe(200);
    const [row] = await ctx.db.query(
      `SELECT actor_sub, before, after, request_id FROM audit_logs WHERE entity_id = $1`,
      [target],
    );
    expect(row).toEqual({
      actor_sub: admin,
      before: { userStatus: 'active' },
      after: { userStatus: 'blocked' },
      request_id: 'e2e-rbac-0001',
    });
  });

  it('refresh: rota el refresh token; un token reutilizado cierra la sesión', async () => {
    const sub = await insertUser(ctx.db);
    ctx.cognitoSend.mockResolvedValueOnce({
      AuthenticationResult: {
        AccessToken: signAccessToken({ sub }),
        RefreshToken: 'rt-2',
        ExpiresIn: 900,
      },
    });
    const ok = await http.post('/api/auth/refresh').set('Cookie', `${RT}=rt-1`);
    expect(ok.status).toBe(200);
    expect(findCookie(ok, RT)).toContain('rt-2');
    expect(ctx.cognitoSend.mock.calls[0][0].input).toMatchObject({
      ClientSecret: 'test-client-secret',
      RefreshToken: 'rt-1',
    });

    ctx.cognitoSend.mockRejectedValueOnce(
      Object.assign(new Error('x'), { name: 'RefreshTokenReuseException' }),
    );
    const reused = await http.post('/api/auth/refresh').set('Cookie', `${RT}=rt-1`);
    expect(reused.status).toBe(401);
    expect(findCookie(reused, AT)).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('logout: revoca el refresh token, limpia cookies y audita al usuario aunque el token haya expirado', async () => {
    const sub = await insertUser(ctx.db);
    ctx.cognitoSend.mockResolvedValueOnce({});
    const expired = signAccessToken({ sub }, { expiresIn: -60 });
    const res = await http
      .post('/api/auth/logout')
      .set('Sec-Fetch-Site', 'same-origin')
      .set('Cookie', [`${AT}=${expired}`, `${RT}=rt-9`]);
    expect(res.status).toBe(204);
    expect(ctx.cognitoSend.mock.calls[0][0].input).toMatchObject({ Token: 'rt-9' });
    expect(findCookie(res, RT)).toMatch(/Expires=Thu, 01 Jan 1970/);
    const rows = await ctx.db.query(
      `SELECT 1 FROM audit_logs WHERE action='USER_LOGOUT' AND actor_sub=$1`,
      [sub],
    );
    expect(rows).toHaveLength(1);
  });

  it('CSRF: una mutación cross-site se rechaza aunque traiga cookies', async () => {
    const res = await http
      .post('/api/auth/logout')
      .set('Sec-Fetch-Site', 'cross-site')
      .set('Cookie', `${RT}=x`);
    expect(res.status).toBe(403);
  });

  it('auditoría inmutable: la base rechaza UPDATE sobre audit_logs', async () => {
    await expect(ctx.db.query(`UPDATE audit_logs SET action = 'X'`)).rejects.toThrow(/append-only/);
  });
});
```

```ts
// test/auth-flows.e2e-spec.ts
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, insertUser, signAccessToken, type TestContext } from './support/test-app';

const MFA = '<app-short>_mfa';
const AT = '<app-short>_at';
const cognitoError = (name: string) => Object.assign(new Error(name), { name });
const cookieOf = (res: request.Response, name: string) =>
  ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? [])
    .find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0];

describe('Registro, recuperación y retos (e2e)', () => {
  let ctx: TestContext;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    ctx = await createTestApp();
    http = request(ctx.app.getHttpServer());
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.destroy();
  });
  beforeEach(() => ctx.cognitoSend.mockReset());

  const signup = (email: string) => ({
    email,
    password: 'Contraseña-Segura-1',
    firstName: 'Ana',
    lastName: 'Pérez',
    acceptedTerms: true,
  });

  it('signup: crea usuario, consentimiento y auditoría en una transacción', async () => {
    const sub = randomUUID();
    ctx.cognitoSend.mockResolvedValueOnce({ UserSub: sub });
    const res = await http.post('/api/auth/signup').send(signup('Nueva@Ejemplo.com'));
    expect(res.status).toBe(201);
    const [user] = await ctx.db.query(`SELECT email, cognito_status FROM users WHERE id=$1`, [sub]);
    expect(user).toEqual({ email: 'nueva@ejemplo.com', cognito_status: 'unconfirmed' });
    const terms = await ctx.db.query(
      `SELECT terms_version FROM user_terms_acceptances WHERE user_sub=$1`,
      [sub],
    );
    expect(terms).toHaveLength(1);
    const audit = await ctx.db.query(
      `SELECT 1 FROM audit_logs WHERE action='USER_SIGNUP' AND actor_sub=$1`,
      [sub],
    );
    expect(audit).toHaveLength(1);
  });

  it('signup: email existente responde igual que uno nuevo (anti-enumeración)', async () => {
    ctx.cognitoSend.mockRejectedValueOnce(cognitoError('UsernameExistsException'));
    const res = await http.post('/api/auth/signup').send(signup('repetido@ejemplo.com'));
    expect(res.status).toBe(201);
    expect(res.body.message).toContain('código');
  });

  it('signup: si la base falla, borra la identidad de Cognito (rollback)', async () => {
    const existing = await insertUser(ctx.db);
    ctx.cognitoSend.mockResolvedValueOnce({ UserSub: existing }).mockResolvedValueOnce({});
    const res = await http.post('/api/auth/signup').send(signup('choque@ejemplo.com'));
    expect(res.status).toBe(500);
    const rollback = ctx.cognitoSend.mock.calls[1][0];
    expect(rollback.constructor.name).toBe('AdminDeleteUserCommand');
    expect(rollback.input.Username).toBe(existing);
  });

  it('signup: contraseña débil → 400 con el mensaje de la política', async () => {
    const res = await http
      .post('/api/auth/signup')
      .send({ ...signup('debil@ejemplo.com'), password: 'corta' });
    expect(res.status).toBe(400);
    expect(res.body.message.join(' ')).toContain('12 y 128');
  });

  it('confirm: marca la cuenta como confirmada', async () => {
    await insertUser(ctx.db, { email: 'confirmar@ejemplo.com' });
    await ctx.db.query(
      `UPDATE users SET cognito_status='unconfirmed' WHERE email='confirmar@ejemplo.com'`,
    );
    ctx.cognitoSend.mockResolvedValueOnce({});
    const res = await http
      .post('/api/auth/confirm')
      .send({ email: 'confirmar@ejemplo.com', code: '123456' });
    expect(res.status).toBe(200);
    const [row] = await ctx.db.query(
      `SELECT cognito_status FROM users WHERE email='confirmar@ejemplo.com'`,
    );
    expect(row.cognito_status).toBe('confirmed');
  });

  it('confirm: código incorrecto → 400', async () => {
    ctx.cognitoSend.mockRejectedValueOnce(cognitoError('CodeMismatchException'));
    const res = await http
      .post('/api/auth/confirm')
      .send({ email: 'x@ejemplo.com', code: '000000' });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('El código no es correcto.');
  });

  it.each(['resend-code', 'forgot-password'])(
    '%s: usuario inexistente responde 200 genérico',
    async (path) => {
      ctx.cognitoSend.mockRejectedValueOnce(cognitoError('UserNotFoundException'));
      const res = await http.post(`/api/auth/${path}`).send({ email: 'nadie@ejemplo.com' });
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('Si el correo está registrado');
    },
  );

  it('confirm-password: restablece y audita', async () => {
    const sub = await insertUser(ctx.db, { email: 'reset@ejemplo.com' });
    ctx.cognitoSend.mockResolvedValueOnce({});
    const res = await http
      .post('/api/auth/confirm-password')
      .send({ email: 'reset@ejemplo.com', code: '123456', newPassword: 'Contraseña-Nueva-22' });
    expect(res.status).toBe(200);
    const audit = await ctx.db.query(
      `SELECT 1 FROM audit_logs WHERE action='USER_CONFIRM_PASSWORD' AND actor_sub=$1`,
      [sub],
    );
    expect(audit).toHaveLength(1);
  });

  it('demasiados intentos en Cognito → 429', async () => {
    ctx.cognitoSend.mockRejectedValueOnce(cognitoError('TooManyRequestsException'));
    const res = await http.post('/api/auth/login').send({ email: 'x@ejemplo.com', password: 'x' });
    expect(res.status).toBe(429);
  });

  it('invitación: NEW_PASSWORD_REQUIRED → MFA_SETUP → secreto TOTP → sesión', async () => {
    const sub = await insertUser(ctx.db, { email: 'invitado@ejemplo.com' });
    ctx.cognitoSend
      .mockResolvedValueOnce({
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        Session: 's1',
        ChallengeParameters: { USER_ID_FOR_SRP: sub },
      })
      .mockResolvedValueOnce({ ChallengeName: 'MFA_SETUP', Session: 's2', ChallengeParameters: {} })
      .mockResolvedValueOnce({ SecretCode: 'JBSWY3DPEHPK3PXP', Session: 's3' })
      .mockResolvedValueOnce({ Status: 'SUCCESS', Session: 's4' })
      .mockResolvedValueOnce({
        AuthenticationResult: {
          AccessToken: signAccessToken({ sub }),
          RefreshToken: 'rt',
          ExpiresIn: 900,
        },
      });

    const login = await http
      .post('/api/auth/login')
      .send({ email: 'invitado@ejemplo.com', password: 'temporal' });
    expect(login.body).toEqual({ status: 'challenge', challenge: 'NEW_PASSWORD_REQUIRED' });

    const pwd = await http
      .post('/api/auth/challenge')
      .set('Cookie', cookieOf(login, MFA)!)
      .send({ challenge: 'NEW_PASSWORD_REQUIRED', newPassword: 'Contraseña-Segura-1' });
    expect(pwd.body).toEqual({ status: 'challenge', challenge: 'MFA_SETUP' });
    expect(ctx.cognitoSend.mock.calls[1][0].input.ChallengeResponses).toMatchObject({
      USERNAME: sub,
      NEW_PASSWORD: 'Contraseña-Segura-1',
    });

    const setup = await http
      .post('/api/auth/challenge/mfa-setup')
      .set('Cookie', cookieOf(pwd, MFA)!);
    expect(setup.status).toBe(200);
    expect(setup.body.secretCode).toBe('JBSWY3DPEHPK3PXP');
    expect(setup.body.otpauthUri).toMatch(
      /^otpauth:\/\/totp\/.+invitado%40ejemplo\.com\?secret=JBSWY3DPEHPK3PXP&issuer=/,
    );

    const done = await http
      .post('/api/auth/challenge')
      .set('Cookie', cookieOf(setup, MFA)!)
      .send({ challenge: 'MFA_SETUP', code: '123456' });
    expect(done.body.status).toBe('authenticated');
    expect(ctx.cognitoSend.mock.calls[3][0].input).toMatchObject({
      Session: 's3',
      UserCode: '123456',
    });
    expect(ctx.cognitoSend.mock.calls[4][0].input).toMatchObject({
      ChallengeName: 'MFA_SETUP',
      Session: 's4',
    });
    const enrolled = await ctx.db.query(
      `SELECT 1 FROM audit_logs WHERE action='USER_MFA_ENROLLED' AND actor_sub=$1`,
      [sub],
    );
    expect(enrolled).toHaveLength(1);
  });

  it('logout-all: cierra la sesión global con el access token', async () => {
    const sub = await insertUser(ctx.db);
    const token = signAccessToken({ sub });
    ctx.cognitoSend.mockResolvedValueOnce({});
    const res = await http.post('/api/auth/logout-all').set('Cookie', `${AT}=${token}`);
    expect(res.status).toBe(204);
    expect(ctx.cognitoSend.mock.calls[0][0].input).toEqual({ AccessToken: token });
  });

  it('health y terms-link son públicos', async () => {
    expect((await http.get('/api/health')).body).toMatchObject({ status: 'ok' });
    expect((await http.get('/api/auth/terms-link')).body).toEqual({ url: '<TERMS_URL>' });
  });
});
```

```ts
// test/projects.e2e-spec.ts
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, insertUser, signAccessToken, type TestContext } from './support/test-app';

const AT = '<app-short>_at';

describe('Módulo de ejemplo: proyectos (e2e)', () => {
  let ctx: TestContext;
  let http: ReturnType<typeof request>;
  let operador: string;
  let admin: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    http = request(ctx.app.getHttpServer());
    operador = `${AT}=${signAccessToken({ sub: await insertUser(ctx.db), groups: ['<ROL_A>'] })}`;
    admin = `${AT}=${signAccessToken({ sub: await insertUser(ctx.db), groups: ['<ROL_B>'] })}`;
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.destroy();
  });

  it('crea, normaliza el código y devuelve el DTO público (sin campos internos)', async () => {
    const res = await http
      .post('/api/projects')
      .set('Cookie', operador)
      .send({ code: ' prj-00001 ', name: 'ERP', budget: '15000.50', startsOn: '2026-11-01' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      code: 'PRJ-00001',
      budget: '15000.50',
      startsOn: '2026-11-01',
      status: 'draft',
      version: 1,
    });
    expect(res.body).not.toHaveProperty('ownerSub');
    expect(res.body).not.toHaveProperty('metadata');
  });

  it('código duplicado → 409 (lo detecta la restricción única, sin carrera)', async () => {
    const results = await Promise.all(
      [1, 2].map(() =>
        http
          .post('/api/projects')
          .set('Cookie', operador)
          .send({ code: 'PRJ-00002', name: 'Doble' }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('validación: formato de código, fecha y campos desconocidos → 400', async () => {
    const res = await http
      .post('/api/projects')
      .set('Cookie', operador)
      .send({ code: 'MAL', name: 'x', startsOn: '01/11/2026', extra: true });
    expect(res.status).toBe(400);
    expect(res.body.message).toEqual(
      expect.arrayContaining([
        'property extra should not exist',
        'El código debe tener el formato XXX-00000.',
      ]),
    );
  });

  it('lista paginada con total, filtro y búsqueda', async () => {
    for (let i = 10; i < 15; i++) {
      await http
        .post('/api/projects')
        .set('Cookie', operador)
        .send({ code: `ABC-000${i}`, name: `Proyecto ${i}` });
    }
    const page = await http.get('/api/projects?limit=2&offset=0&q=abc').set('Cookie', operador);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ total: 5, limit: 2, offset: 0 });
    expect(page.body.items).toHaveLength(2);

    const tooBig = await http.get('/api/projects?limit=1000').set('Cookie', operador);
    expect(tooBig.status).toBe(400);
  });

  it('búsqueda: los comodines de LIKE del usuario se escapan', async () => {
    const res = await http.get('/api/projects?q=%25').set('Cookie', operador);
    expect(res.body.total).toBe(0);
  });

  it('editar: solo admin; versión vieja → 409; auditoría con antes/después', async () => {
    const created = await http
      .post('/api/projects')
      .set('Cookie', operador)
      .send({ code: 'OPT-00001', name: 'Original' });
    const id = created.body.id as string;

    const forbidden = await http
      .patch(`/api/projects/${id}`)
      .set('Cookie', operador)
      .send({ name: 'X', version: 1 });
    expect(forbidden.status).toBe(403);

    const first = await http
      .patch(`/api/projects/${id}`)
      .set('Cookie', admin)
      .send({ name: 'Editado', version: 1 });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ name: 'Editado', version: 2 });

    const stale = await http
      .patch(`/api/projects/${id}`)
      .set('Cookie', admin)
      .send({ status: 'active', version: 1 });
    expect(stale.status).toBe(409);

    const [audit] = await ctx.db.query(
      `SELECT before, after FROM audit_logs WHERE action = 'PROJECT_UPDATED' AND entity_id = $1`,
      [id],
    );
    expect(audit.before).toMatchObject({ name: 'Original' });
    expect(audit.after).toMatchObject({ name: 'Editado' });
  });

  it('id con formato inválido → 400; inexistente → 404', async () => {
    expect((await http.get('/api/projects/no-es-uuid').set('Cookie', operador)).status).toBe(400);
    expect(
      (await http.get('/api/projects/00000000-0000-4000-8000-000000000000').set('Cookie', operador))
        .status,
    ).toBe(404);
  });
});
```

```ts
// test/documents.e2e-spec.ts
import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, insertUser, signAccessToken, type TestContext } from './support/test-app';

const AT = '<app-short>_at';
const pdf = Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const sha = createHash('sha256').update(pdf).digest('hex');

describe('Documentos en modo local (e2e)', () => {
  let ctx: TestContext;
  let http: ReturnType<typeof request>;
  let cookie: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    http = request(ctx.app.getHttpServer());
    cookie = `${AT}=${signAccessToken({ sub: await insertUser(ctx.db), groups: ['<ROL_A>'] })}`;
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.destroy();
  });

  const intent = {
    entityId: '20123456789',
    documentType: '<DOC_TIPO_1>',
    filename: 'EEFF 2026.pdf',
    contentType: 'application/pdf',
    sizeBytes: pdf.length,
    sha256: sha,
  };

  it('subida completa: intención → PUT local → procesado → listado → descarga auditada', async () => {
    const created = await http.post('/api/documents/uploads').set('Cookie', cookie).send(intent);
    expect(created.status).toBe(201);
    expect(created.body.result).toBe('upload');
    const put = await http
      .put(created.body.uploadUrl)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/pdf')
      .send(pdf);
    expect(put.status).toBe(200);
    expect(put.body.status).toBe('processed');

    const list = await http.get('/api/documents?entityId=20123456789').set('Cookie', cookie);
    expect(list.body.total).toBe(1);

    const dl = await http
      .get(`/api/documents/${created.body.documentId}/download`)
      .set('Cookie', cookie);
    expect(dl.status).toBe(200);
    const audit = await ctx.db.query(
      `SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY occurred_at`,
      [created.body.documentId],
    );
    expect(audit.map((a: { action: string }) => a.action)).toEqual([
      'GENERATE_PRESIGNED_URL',
      'DOWNLOAD_DOCUMENT',
    ]);
  });

  it('mismo contenido otra vez → duplicate, sin fila nueva', async () => {
    const again = await http.post('/api/documents/uploads').set('Cookie', cookie).send(intent);
    expect(again.body.result).toBe('duplicate');
    const [{ count }] = await ctx.db.query(
      `SELECT count(*)::int AS count FROM documents WHERE sha256 = $1`,
      [sha],
    );
    expect(count).toBe(1);
  });

  it('archivo que no coincide con el hash declarado → 400', async () => {
    const other = { ...intent, sha256: 'b'.repeat(64) };
    const created = await http.post('/api/documents/uploads').set('Cookie', cookie).send(other);
    const put = await http
      .put(created.body.uploadUrl)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/pdf')
      .send(pdf);
    expect(put.status).toBe(400);
  });

  it('validación: tipo no permitido, tamaño excesivo → 400', async () => {
    const res = await http
      .post('/api/documents/uploads')
      .set('Cookie', cookie)
      .send({ ...intent, contentType: 'image/png', sizeBytes: 50 * 1024 * 1024 });
    expect(res.status).toBe(400);
    expect(res.body.message).toEqual(
      expect.arrayContaining([
        'Solo se aceptan archivos PDF.',
        'El archivo supera el tamaño máximo de 20 MB.',
      ]),
    );
  });
});
```

```ts
// test/ingest.e2e-spec.ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Document } from '../src/modules/documents/document.entity';
import { processScanResult, type ScanResultEvent } from '../src/modules/documents/ingest.processor';
import { createTestApp, type TestContext } from './support/test-app';

const event = (
  key: string,
  verdict: string,
  scanStatus: 'COMPLETED' | 'FAILED' = 'COMPLETED',
): ScanResultEvent => ({
  'detail-type': 'GuardDuty Malware Protection Object Scan Result',
  detail: {
    scanStatus,
    s3ObjectDetails: {
      bucketName: 'docs',
      objectKey: encodeURIComponent(key).replace(/%2F/g, '/'),
    },
    scanResultDetails: {
      scanResultStatus: verdict,
      threats: verdict === 'THREATS_FOUND' ? [{ name: 'EICAR-Test-File' }] : null,
    },
  },
});

describe('Worker de ingesta (e2e)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx.app.close();
    await ctx.db.destroy();
  });

  async function newDoc(): Promise<Document> {
    const sha = randomUUID().replace(/-/g, '').padEnd(64, '0');
    return ctx.db.getRepository(Document).save({
      filename: 'Estado financiero 2026.pdf',
      s3Key: `incoming/20123456789/estado_financiero/${randomUUID()}-${sha.slice(0, 8)} doc.pdf`,
      entityId: '20123456789',
      documentType: 'estado_financiero',
      status: 'scanning',
      sha256: sha,
      contentType: 'application/pdf',
      sizeBytes: 1024,
    });
  }

  it('archivo limpio: se mueve a raw/, se procesa y queda processed (idempotente)', async () => {
    const doc = await newDoc();
    const s3 = { move: vi.fn().mockResolvedValue(undefined) };
    const deps = {
      db: ctx.db,
      s3,
      process: vi.fn().mockResolvedValue({ validationStatus: 'OK' }),
      parserVersion: '1.0.0',
    };
    expect(await processScanResult(event(doc.s3Key, 'NO_THREATS_FOUND'), deps)).toBe('processed');
    expect(s3.move).toHaveBeenCalledWith('docs', doc.s3Key, doc.s3Key.replace('incoming/', 'raw/'));
    const saved = await ctx.db.getRepository(Document).findOneByOrFail({ id: doc.id });
    expect(saved).toMatchObject({
      status: 'processed',
      parserVersion: '1.0.0',
      s3Key: doc.s3Key.replace('incoming/', 'raw/'),
    });
    // Segunda entrega del mismo evento (SQS es at-least-once): no hace nada.
    expect(await processScanResult(event(doc.s3Key, 'NO_THREATS_FOUND'), deps)).toBe('skipped');
  });

  it('amenaza: va a quarantine/ con el nombre de la amenaza', async () => {
    const doc = await newDoc();
    const s3 = { move: vi.fn().mockResolvedValue(undefined) };
    const outcome = await processScanResult(event(doc.s3Key, 'THREATS_FOUND'), {
      db: ctx.db,
      s3,
      process: vi.fn(),
      parserVersion: '1.0.0',
    });
    expect(outcome).toBe('quarantined');
    const saved = await ctx.db.getRepository(Document).findOneByOrFail({ id: doc.id });
    expect(saved).toMatchObject({ status: 'quarantined', errorMessage: 'EICAR-Test-File' });
  });

  it('error del procesador: queda failed con el mensaje, nunca colgado en processing', async () => {
    const doc = await newDoc();
    const outcome = await processScanResult(event(doc.s3Key, 'NO_THREATS_FOUND'), {
      db: ctx.db,
      s3: { move: vi.fn().mockResolvedValue(undefined) },
      process: vi.fn().mockRejectedValue(new Error('PDF corrupto')),
      parserVersion: '1.0.0',
    });
    expect(outcome).toBe('failed');
    const saved = await ctx.db.getRepository(Document).findOneByOrFail({ id: doc.id });
    expect(saved).toMatchObject({
      status: 'failed',
      errorMessage: 'PDF corrupto',
      validationStatus: 'PARSER_ERROR',
    });
  });
});
```

Al añadir un módulo de dominio se añade su `*.e2e-spec.ts` siguiendo `projects`: feliz, 401 sin cookie, 403 sin rol, 409 de conflicto, 400 de validación. No se mockea el repositorio. Si el test necesita un usuario, se inserta la fila y se firma un token con su `sub`.

### 15.4 Lo que la suite no prueba

El primer despliegue real (Cognito, RDS Proxy, CloudFront, GuardDuty) no cabe en esta suite. Lo cubre `scripts/synth-check.sh` a nivel de plantilla CloudFormation y `scripts/ci/smoke.sh` contra el stage desplegado. Los dos están en las secciones 16 y 17. Decir "los tests pasan" no sustituye el smoke de un stage.

---
## 16. Infraestructura como código (AWS CDK)

🆕 **V2.** Todo lo que en la v1 se creaba a mano o en `serverless.yml` es un stack CDK. cdk-nag con el pack `AwsSolutions` es un gate: `cdk synth` falla si aparece un hallazgo sin justificar.

Verificado el 07/10/2026 con `scripts/synth-check.sh`, marcadores sustituidos por valores ficticios, región `sa-east-1` (hay referencias entre regiones: el WAF y el certificado viven en `us-east-1`):

| Síntesis | Stacks | Recursos (aprox.) |
|---|---|---|
| `dev`, `qa` | 9 | 147 |
| `prod` | 9 | 148 (CodeDeploy del canary) |
| `ci=nonprod`, `ci=prod` | 1 | 8 |

Cero hallazgos sin una entrada en `infra/lib/nag.ts`.

### 16.1 Cómo se sintetiza

Archivo: `infra/cdk.json`

```json
{
  "app": "npx tsx bin/app.ts",
  "watch": {
    "include": [
      "bin/**",
      "lib/**"
    ]
  },
  "context": {
    "@aws-cdk/aws-lambda:recognizeLayerVersion": true,
    "@aws-cdk/core:checkSecretUsage": true,
    "@aws-cdk/core:target-partitions": [
      "aws"
    ],
    "@aws-cdk/aws-iam:minimizePolicies": true,
    "@aws-cdk/core:validateSnapshotRemovalPolicy": true,
    "@aws-cdk/aws-s3:createDefaultLoggingPolicy": true,
    "@aws-cdk/aws-s3:serverAccessLogsUseBucketPolicy": true,
    "@aws-cdk/aws-rds:preventRenderingDeprecatedCredentials": true,
    "@aws-cdk/aws-lambda:useCdkManagedLogGroup": true,
    "@aws-cdk/core:defaultCrossStackReferences": "weak"
  }
}
```

```ts
// infra/bin/app.ts
#!/usr/bin/env node
import { App, type Stack, Tags, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { AlertsStack } from '../lib/alerts-stack';
import { ApiStack } from '../lib/api-stack';
import { AuthStack } from '../lib/auth-stack';
import { CiStack } from '../lib/ci-stack';
import { CONFIG, type Stage } from '../lib/config';
import { DataStack } from '../lib/data-stack';
import { EdgeStack } from '../lib/edge-stack';
import { MigratorStack } from '../lib/migrator-stack';
import { acknowledgeIamWildcards, acknowledgeNagFindings } from '../lib/nag';
import { APP, ORG } from '../lib/naming';
import { NetworkStack } from '../lib/network-stack';
import { StorageStack } from '../lib/storage-stack';
import { WebStack } from '../lib/web-stack';

/**
 * Uso:
 *   cdk deploy --all -c stage=dev            → todos los stacks de un stage
 *   cdk deploy -c ci=nonprod <app-short>-ci  → roles de CI de la cuenta no-prod (una vez, admin)
 */
const app = new App();
Tags.of(app).add('app', APP);
Tags.of(app).add('owner', ORG);
Tags.of(app).add('managed-by', 'cdk');
// Reglas AWS Solutions: un hallazgo no reconocido hace fallar `cdk synth` (y el CI).
Validations.of(app).addPlugins(new AwsSolutionsChecks(app));

const ciAccount = app.node.tryGetContext('ci') as 'nonprod' | 'prod' | undefined;
if (ciAccount) {
  const cfg = ciAccount === 'prod' ? CONFIG.prod : CONFIG.dev;
  const ci = new CiStack(app, `${APP}-ci`, ciAccount === 'prod' ? ['prod'] : ['dev', 'qa'], {
    env: { account: cfg.account, region: cfg.region },
  });
  acknowledgeIamWildcards([ci]);
} else {
  const stage = app.node.tryGetContext('stage') as Stage | undefined;
  if (!stage || !(stage in CONFIG)) throw new Error('Indica el stage: -c stage=dev|qa|prod');
  const cfg = CONFIG[stage];
  Tags.of(app).add('stage', stage);

  const env = { account: cfg.account, region: cfg.region };
  const crossRegion = cfg.region !== 'us-east-1';
  const id = (layer: string) => `${APP}-${stage}-${layer}`;

  const stacks: Stack[] = [];
  const track = <T extends Stack>(s: T): T => (stacks.push(s), s);

  track(new AlertsStack(app, id('alerts'), cfg, { env }));
  const network = track(new NetworkStack(app, id('network'), cfg, { env }));
  const data = track(new DataStack(app, id('data'), cfg, network.vpc, { env }));
  const auth = track(new AuthStack(app, id('auth'), cfg, { env }));
  const storage = track(new StorageStack(app, id('storage'), cfg, { env }));
  track(
    new MigratorStack(
      app,
      id('migrator'),
      cfg,
      { vpc: network.vpc, data, userPool: auth.userPool },
      { env },
    ),
  );
  const api = track(
    new ApiStack(
      app,
      id('api'),
      cfg,
      {
        vpc: network.vpc,
        data,
        userPool: auth.userPool,
        userPoolClient: auth.client,
        clientSecret: auth.clientSecret,
      },
      { env },
    ),
  );
  const edge = track(
    new EdgeStack(app, id('edge'), cfg, {
      env: { account: cfg.account, region: 'us-east-1' },
      crossRegionReferences: crossRegion,
    }),
  );
  track(
    new WebStack(
      app,
      id('web'),
      cfg,
      {
        certificate: edge.certificate,
        webAclArn: edge.webAclArn,
        apiId: api.httpApi.apiId,
        originVerifySecret: api.originVerifySecret,
      },
      { env, crossRegionReferences: crossRegion },
    ),
  );
  api.addStackDependency(storage, 'La API usa el bucket y la cola de ingesta por nombre');
  stacks.at(-1)!.addStackDependency(storage, 'CloudFront escribe sus logs en el bucket de logs');
  acknowledgeNagFindings(stacks, cfg);
  acknowledgeIamWildcards(stacks);
}
```

`cdk.json` fija `@aws-cdk/core:defaultCrossStackReferences` en `weak`. Las referencias fuertes entre estos stacks se cruzan (la API necesita el bucket, el bucket necesita el ARN de la cola, la red necesita los dos) y CDK se niega a sintetizar por un ciclo. Las referencias débiles son nombres y ARNs **deterministas** que cada stack calcula con `naming.ts`, no exports de CloudFormation. El precio es que CDK ya no ordena el despliegue por esas referencias: el pipeline despliega en el orden de la sección 17, a propósito.

Dos modos de `cdk`:

- `-c stage=dev|qa|prod` sintetiza los nueve stacks de un stage.
- `-c ci=nonprod|prod` sintetiza solo el stack de OIDC de esa cuenta. Se despliega **una vez por cuenta**, antes que cualquier stage.

No se llama `stack.addDependency` (está deprecado). Cuando hace falta un orden dentro de la app, es `node.addDependency` / `addStackDependency`.

### 16.2 Configuración por stage

```ts
// infra/lib/config.ts
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

export type Stage = 'dev' | 'qa' | 'prod';

export interface StageConfig {
  stage: Stage;
  account: string;
  region: string;
  /** Dominio público del stage: front y API bajo el mismo origen. */
  domainName: string;
  hostedZoneId: string;
  hostedZoneName: string;
  alertEmail: string;
  sentryDsn?: string;
  auth: {
    /** ESSENTIALS: rotación de refresh token y MFA. PLUS: además protección contra amenazas (más costo por usuario). */
    featurePlan: 'ESSENTIALS' | 'PLUS';
    selfSignup: boolean;
    /** REQUIRED: todo usuario configura TOTP en su primer login. OPTIONAL: cada usuario decide. */
    mfa: 'REQUIRED' | 'OPTIONAL';
  };
  network: { maxAzs: number; natGateways: number };
  db: {
    instanceClass: string;
    multiAz: boolean;
    allocatedStorageGb: number;
    maxAllocatedStorageGb: number;
    backupRetentionDays: number;
    deletionProtection: boolean;
  };
  api: {
    memoryMb: number;
    /** Instancias precalentadas del alias `live` (elimina arranques en frío; cuesta por hora). */
    provisionedConcurrency: number;
    throttleRatePerSecond: number;
    throttleBurst: number;
    /** Despliegue gradual con CodeDeploy y rollback automático por alarma. */
    canary: boolean;
  };
  /** Países (ISO 3166-1 alfa-2) desde los que se sirve la app. Vacío = sin restricción. */
  geoAllowList: string[];
  logRetentionDays: RetentionDays;
  monthlyBudgetUsd: number;
}

const common = {
  region: '<REGION>',
  hostedZoneId: '<HOSTED_ZONE_ID>',
  hostedZoneName: '<DOMINIO_BASE>',
  alertEmail: '<ALERT_EMAIL>',
  sentryDsn: '<SENTRY_DSN_BACKEND>',
};

export const GITHUB = {
  org: '<GITHUB_ORG>',
  backendRepo: '<app>',
  frontendRepo: '<app-frontend>',
};

export const CONFIG: Record<Stage, StageConfig> = {
  dev: {
    ...common,
    stage: 'dev',
    account: '<ACCOUNT_NONPROD>',
    domainName: 'app-dev.<DOMINIO_BASE>',
    auth: { featurePlan: 'ESSENTIALS', selfSignup: true, mfa: 'REQUIRED' },
    network: { maxAzs: 2, natGateways: 1 },
    db: {
      instanceClass: 't4g.micro',
      multiAz: false,
      allocatedStorageGb: 20,
      maxAllocatedStorageGb: 50,
      backupRetentionDays: 7,
      deletionProtection: false,
    },
    api: {
      memoryMb: 1536,
      provisionedConcurrency: 0,
      throttleRatePerSecond: 50,
      throttleBurst: 100,
      canary: false,
    },
    geoAllowList: [],
    logRetentionDays: RetentionDays.ONE_MONTH,
    monthlyBudgetUsd: 150,
  },
  qa: {
    ...common,
    stage: 'qa',
    account: '<ACCOUNT_NONPROD>',
    domainName: 'app-qa.<DOMINIO_BASE>',
    auth: { featurePlan: 'ESSENTIALS', selfSignup: true, mfa: 'REQUIRED' },
    network: { maxAzs: 2, natGateways: 1 },
    db: {
      instanceClass: 't4g.small',
      multiAz: false,
      allocatedStorageGb: 20,
      maxAllocatedStorageGb: 100,
      backupRetentionDays: 7,
      deletionProtection: false,
    },
    api: {
      memoryMb: 1536,
      provisionedConcurrency: 0,
      throttleRatePerSecond: 50,
      throttleBurst: 100,
      canary: false,
    },
    geoAllowList: [],
    logRetentionDays: RetentionDays.ONE_MONTH,
    monthlyBudgetUsd: 200,
  },
  prod: {
    ...common,
    stage: 'prod',
    account: '<ACCOUNT_PROD>',
    domainName: 'app.<DOMINIO_BASE>',
    auth: { featurePlan: 'ESSENTIALS', selfSignup: true, mfa: 'REQUIRED' },
    network: { maxAzs: 2, natGateways: 2 },
    db: {
      instanceClass: 'm7g.large',
      multiAz: true,
      allocatedStorageGb: 50,
      maxAllocatedStorageGb: 500,
      backupRetentionDays: 35,
      deletionProtection: true,
    },
    api: {
      memoryMb: 1769,
      provisionedConcurrency: 2,
      throttleRatePerSecond: 500,
      throttleBurst: 1000,
      canary: true,
    },
    geoAllowList: [],
    logRetentionDays: RetentionDays.THIRTEEN_MONTHS,
    monthlyBudgetUsd: 1500,
  },
};
```

Los tres stages están en el mismo archivo para que un cambio de tamaño de instancia o de memoria sea un diff revisable, no un clic en la consola. Prod se separa de los otros en: cuenta, Multi-AZ, deletion protection, backup de 35 días, dos NAT, memoria 1769 MB, dos instancias provisionadas, canary, presupuesto, retención de logs de 13 meses.

`auth.featurePlan` queda en `ESSENTIALS`. Pasarlo a `PLUS` enciende la protección contra amenazas de Cognito (credenciales comprometidas, inicio de sesión adaptativo) y cambia el precio por usuario activo. Es una línea; la decisión de negocio está en el Anexo A. `geoAllowList` vacío significa sin filtro geográfico. Llenarlo con códigos ISO activa la regla de WAF.

`selfSignup: true` y `mfa: 'REQUIRED'` acompañan al user pool. Cerrar el alta es poner `selfSignup: false` y dar de alta a la gente con `create-admin` o con `AdminCreateUser`.

### 16.3 Nombres

```ts
// infra/lib/naming.ts
import type { StageConfig } from './config';

export const APP = '<app-short>';
export const ORG = '<org>';

/** Nombre físico de un recurso según la convención de 1.2. */
export const name = (cfg: StageConfig, suffix: string) => `${APP}-${cfg.stage}-${suffix}`;

/** Prefijo de secretos y parámetros SSM: /<org>/<app-short>/<stage>/ */
export const paramPath = (cfg: StageConfig, key: string) => `/${ORG}/${APP}/${cfg.stage}/${key}`;

/**
 * Tema SNS de alarmas, creado por AlertsStack con nombre determinista. Los
 * demás stacks lo referencian por ARN (sin exports entre stacks, que impiden
 * cambiar o borrar recursos sin desplegar en orden).
 */
/** Nombres deterministas de los recursos de StorageStack: otros stacks los referencian sin exports. */
export const docsBucketName = (cfg: StageConfig) => `${name(cfg, 'docs')}-${cfg.account}`;
export const logsBucketName = (cfg: StageConfig) => `${name(cfg, 'logs')}-${cfg.account}`;
export const ingestQueueArn = (cfg: StageConfig) =>
  `arn:aws:sqs:${cfg.region}:${cfg.account}:${name(cfg, 'ingest')}`;

export const alertsTopicArn = (cfg: StageConfig) =>
  `arn:aws:sns:${cfg.region}:${cfg.account}:${name(cfg, 'alerts')}`;
```

Una función `name(stage, ...partes)` y helpers para los ARNs que se referencian entre stacks sin export: cola de ingesta, topic de alarmas, buckets. Si un nombre se calcula en dos sitios con dos plantillas, la referencia débil apunta a un recurso que no existe y el fallo aparece en el despliegue, no en el synth. Todo pasa por este archivo.

### 16.4 Red y datos

```ts
// infra/lib/network-stack.ts
import { Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import type { StageConfig } from './config';

export class NetworkStack extends Stack {
  readonly vpc: ec2.Vpc;
  private readonly azs: string[];

  constructor(scope: Construct, id: string, cfg: StageConfig, props: StackProps) {
    super(scope, id, props);
    this.azs = ['a', 'b', 'c'].slice(0, cfg.network.maxAzs).map((z) => `${cfg.region}${z}`);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      availabilityZones: this.azs,
      natGateways: cfg.network.natGateways,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        // Lambdas: salen a internet (Cognito JWKS, Sentry) por el NAT.
        { name: 'app', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 22 },
        // Base de datos y proxy: sin ruta a internet en ninguna dirección.
        { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
      gatewayEndpoints: {
        // Tráfico a S3 sin pasar por el NAT: más barato y más rápido.
        S3: { service: ec2.GatewayVpcEndpointAwsService.S3 },
      },
    });

    this.vpc.addFlowLog('FlowLogs', {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(
        new logs.LogGroup(this, 'FlowLogsGroup', { retention: logs.RetentionDays.ONE_MONTH }),
      ),
      trafficType: ec2.FlowLogTrafficType.REJECT,
    });
  }

  /**
   * Zonas explícitas: así `cdk synth` no consulta la cuenta (funciona en CI sin
   * credenciales) y el resultado es determinista. Verificar que existen en la
   * región con `aws ec2 describe-availability-zones`.
   */
  override get availabilityZones(): string[] {
    return this.azs;
  }
}
```

```ts
// infra/lib/data-stack.ts
import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as rds from 'aws-cdk-lib/aws-rds';
import type { Construct } from 'constructs';
import type { StageConfig } from './config';
import { name, paramPath } from './naming';

export const DB_NAME = '<app_snake>';
export const APP_DB_USER = 'app_user';

export class DataStack extends Stack {
  readonly instance: rds.DatabaseInstance;
  readonly proxy: rds.DatabaseProxy;
  /** SG que deben tener las Lambdas que hablan con el proxy. */
  readonly proxyClientSg: ec2.SecurityGroup;
  /** SG del migrator: es el único cliente que entra directo a la instancia. */
  readonly migratorSg: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, cfg: StageConfig, vpc: ec2.IVpc, props: StackProps) {
    super(scope, id, props);
    const isProd = cfg.stage === 'prod';

    const dbSg = new ec2.SecurityGroup(this, 'DbSg', {
      vpc,
      allowAllOutbound: false,
      description: 'RDS',
    });
    const proxySg = new ec2.SecurityGroup(this, 'ProxySg', { vpc, description: 'RDS Proxy' });
    this.proxyClientSg = new ec2.SecurityGroup(this, 'ProxyClientSg', {
      vpc,
      description: 'Clientes del proxy',
    });
    this.migratorSg = new ec2.SecurityGroup(this, 'MigratorSg', {
      vpc,
      description: 'Lambda migrator',
    });
    proxySg.addIngressRule(this.proxyClientSg, ec2.Port.tcp(5432), 'Lambdas -> proxy');
    dbSg.addIngressRule(proxySg, ec2.Port.tcp(5432), 'proxy -> db');
    dbSg.addIngressRule(this.migratorSg, ec2.Port.tcp(5432), 'migrator -> db');

    const parameterGroup = new rds.ParameterGroup(this, 'Params', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_17 }),
      parameters: {
        'rds.force_ssl': '1',
        log_min_duration_statement: '500',
        'pg_stat_statements.track': 'all',
        idle_in_transaction_session_timeout: '60000',
      },
    });

    this.instance = new rds.DatabaseInstance(this, 'Db', {
      instanceIdentifier: name(cfg, 'db'),
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_17 }),
      instanceType: new ec2.InstanceType(cfg.db.instanceClass),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      databaseName: DB_NAME,
      // Usuario maestro con contraseña generada en Secrets Manager. Solo lo usa
      // el migrator (y una persona en caso de emergencia, con registro en CloudTrail).
      credentials: rds.Credentials.fromGeneratedSecret('postgres', {
        secretName: paramPath(cfg, 'db-master'),
      }),
      iamAuthentication: true,
      multiAz: cfg.db.multiAz,
      allocatedStorage: cfg.db.allocatedStorageGb,
      maxAllocatedStorage: cfg.db.maxAllocatedStorageGb,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      parameterGroup,
      backupRetention: Duration.days(cfg.db.backupRetentionDays),
      preferredBackupWindow: '07:00-08:00',
      preferredMaintenanceWindow: 'sun:08:30-sun:09:30',
      deletionProtection: cfg.db.deletionProtection,
      removalPolicy: isProd ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY,
      enablePerformanceInsights: true,
      cloudwatchLogsExports: ['postgresql'],
      autoMinorVersionUpgrade: true,
      copyTagsToSnapshot: true,
    });

    // Rotación automática de la contraseña maestra (la app no la usa: no hay corte).
    this.instance.addRotationSingleUser({ automaticallyAfter: Duration.days(30) });

    // Con IAM de extremo a extremo el PROXY también se autentica con IAM ante la
    // base: su rol necesita rds-db:connect sobre el usuario de BD (CDK no lo añade solo).
    const proxyRole = new iam.Role(this, 'ProxyRole', {
      assumedBy: new iam.ServicePrincipal('rds.amazonaws.com'),
    });
    proxyRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['rds-db:connect'],
        resources: [
          `arn:${this.partition}:rds-db:${this.region}:${this.account}:dbuser:${this.instance.instanceResourceId}/${APP_DB_USER}`,
        ],
      }),
    );

    this.proxy = new rds.DatabaseProxy(this, 'Proxy', {
      role: proxyRole,
      dbProxyName: name(cfg, 'proxy'),
      proxyTarget: rds.ProxyTarget.fromInstance(this.instance),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [proxySg],
      requireTLS: true,
      iamAuth: true,
      // IAM de extremo a extremo: cliente → proxy y proxy → base. Ningún rol de
      // aplicación tiene contraseña; los usuarios de BD llevan GRANT rds_iam (11.5).
      defaultAuthScheme: rds.DefaultAuthScheme.IAM_AUTH,
      idleClientTimeout: Duration.minutes(15),
      borrowTimeout: Duration.seconds(10),
    });
  }
}
```

La VPC tiene subredes públicas (solo NAT), privadas de aplicación (Lambdas) y privadas aisladas (RDS). Sin ruta a internet desde las aisladas. Endpoint gateway de S3 para que el worker y la API hablen con S3 sin NAT. Flow logs a CloudWatch.

`NetworkStack` pisa `availabilityZones` para devolver zonas ficticias durante el synth. Sin eso, CDK intenta llamar a la API de EC2 para descubrir las AZ y `cdk synth` no se puede correr en CI sin credenciales de la cuenta destino. En el despliegue real CDK usa las AZ de la cuenta; el override solo afecta a la síntesis offline. Está limitado a dos AZ, que es `maxAzs`.

RDS PostgreSQL 17, cifrado, backups, Performance Insights, deletion protection solo en prod. El proxy exige TLS y su `DefaultAuthScheme` es `IAM_AUTH`. **CDK no añade solo el permiso `rds-db:connect` al rol del proxy** cuando el esquema es IAM: el stack lo escribe explícito sobre `dbuser/<dbiResourceId>/app_user`. Sin esa línea el proxy no puede entregar conexiones y el síntoma es un timeout, no un 403 claro.

El secreto del maestro lo rota RDS cada 30 días. Lo lee el migrator. La Lambda de la API no tiene permiso de `secretsmanager:GetSecretValue` sobre ese secreto.

### 16.5 Cognito

```ts
// infra/lib/auth-stack.ts
import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';
import type { StageConfig } from './config';
import { name, paramPath } from './naming';

export const ROLE_A = '<ROL_A>';
export const ROLE_B = '<ROL_B>';

export class AuthStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly client: cognito.UserPoolClient;
  readonly clientSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, cfg: StageConfig, props: StackProps) {
    super(scope, id, props);
    const isProd = cfg.stage === 'prod';

    this.userPool = new cognito.UserPool(this, 'Users', {
      userPoolName: name(cfg, 'users'),
      // Essentials: rotación de refresh token, MFA por email, política de contraseñas ampliada.
      featurePlan:
        cfg.auth.featurePlan === 'PLUS' ? cognito.FeaturePlan.PLUS : cognito.FeaturePlan.ESSENTIALS,
      ...(cfg.auth.featurePlan === 'PLUS'
        ? {
            featurePlan: cognito.FeaturePlan.PLUS,
            standardThreatProtectionMode: cognito.StandardThreatProtectionMode.FULL_FUNCTION,
          }
        : {}),
      signInAliases: { email: true },
      signInCaseSensitive: false,
      selfSignUpEnabled: cfg.auth.selfSignup,
      autoVerify: { email: true },
      keepOriginal: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: true, mutable: true },
        familyName: { required: true, mutable: true },
        phoneNumber: { required: false, mutable: true },
      },
      mfa: cfg.auth.mfa === 'REQUIRED' ? cognito.Mfa.REQUIRED : cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      // Debe coincidir con PASSWORD_RULE de auth.dto.ts.
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(3),
        passwordHistorySize: 5,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      deletionProtection: isProd,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      // Para producción, enviar con SES desde el dominio propio (16.5): el correo
      // por defecto de Cognito tiene un cupo diario muy bajo.
      // email: cognito.UserPoolEmail.withSES({ fromEmail: 'no-reply@<DOMINIO_BASE>', sesRegion: cfg.region }),
    });

    for (const group of [ROLE_A, ROLE_B]) {
      new cognito.CfnUserPoolGroup(this, `Group${group.replace(/\W/g, '')}`, {
        userPoolId: this.userPool.userPoolId,
        groupName: group,
      });
    }

    this.client = this.userPool.addClient('Backend', {
      userPoolClientName: name(cfg, 'backend'),
      generateSecret: true,
      authFlows: { userPassword: true, userSrp: false, adminUserPassword: false, custom: false },
      accessTokenValidity: Duration.minutes(15),
      idTokenValidity: Duration.minutes(15),
      refreshTokenValidity: Duration.days(30),
      // Cada renovación emite un refresh token nuevo; el anterior vale 10 s más (reintentos).
      refreshTokenRotationGracePeriod: Duration.seconds(10),
      enableTokenRevocation: true,
      preventUserExistenceErrors: true,
    });

    // El secreto del App Client, copiado a Secrets Manager para que la Lambda
    // lo lea al arrancar sin que aparezca en su configuración.
    this.clientSecret = new secretsmanager.Secret(this, 'ClientSecret', {
      secretName: paramPath(cfg, 'cognito-client-secret'),
      secretStringValue: this.client.userPoolClientSecret,
    });
  }
}
```

User pool con el plan de `config`, MFA por software token, política de contraseña (mínimo 12, los cuatro tipos de carácter, historial 5), recuperación por email. El app client tiene secreto y `USER_PASSWORD_AUTH` (hace falta para el `SECRET_HASH` de la sección 10). Rotación de refresh token activada, `RetryGracePeriodSeconds: 10`.

El secreto del client se copia a Secrets Manager en `/<org>/<app-short>/<stage>/cognito-client`. La Lambda recibe el ARN, no el valor.

El correo de Cognito sale por el email por defecto de la cuenta (cuota baja, remitente `no-reply@verificationemail.com`). Conectar SES es trabajo pendiente: no está en el stack porque exige una identidad verificada en la misma región y una decisión de dominio de correo (Anexo A). Hasta entonces el alta y el "olvidé mi contraseña" funcionan, con ese remitente y ese límite.

### 16.6 Buckets, antivirus, colas, alarmas, migrator

```ts
// infra/lib/storage-stack.ts
import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as guardduty from 'aws-cdk-lib/aws-guardduty';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import type { StageConfig } from './config';
import { alertsTopicArn, docsBucketName, logsBucketName, name } from './naming';

export class StorageStack extends Stack {
  readonly docsBucket: s3.Bucket;
  readonly logsBucket: s3.Bucket;
  readonly ingestQueue: sqs.Queue;
  readonly ingestDlq: sqs.Queue;

  constructor(scope: Construct, id: string, cfg: StageConfig, props: StackProps) {
    super(scope, id, props);
    const isProd = cfg.stage === 'prod';
    const removal = isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    this.logsBucket = new s3.Bucket(this, 'Logs', {
      bucketName: logsBucketName(cfg),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // CloudFront escribe sus logs con ACL: el bucket de logs necesita ACLs de propietario.
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      lifecycleRules: [{ expiration: Duration.days(isProd ? 400 : 90) }],
      removalPolicy: removal,
      autoDeleteObjects: !isProd,
    });

    // El bucket del sitio (WebStack) escribe aquí sus logs de acceso. Como WebStack
    // referencia este bucket por nombre, el permiso se declara aquí explícitamente.
    this.logsBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal('logging.s3.amazonaws.com')],
        actions: ['s3:PutObject'],
        resources: [this.logsBucket.arnForObjects('web/*')],
        conditions: {
          ArnLike: {
            'aws:SourceArn': `arn:${this.partition}:s3:::${name(cfg, 'web')}-${this.account}`,
          },
          StringEquals: { 'aws:SourceAccount': this.account },
        },
      }),
    );

    this.docsBucket = new s3.Bucket(this, 'Docs', {
      bucketName: docsBucketName(cfg),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.KMS_MANAGED,
      bucketKeyEnabled: true,
      enforceSSL: true,
      versioned: true,
      serverAccessLogsBucket: this.logsBucket,
      serverAccessLogsPrefix: 'docs/',
      cors: [
        {
          // Solo el PUT presignado desde el navegador (13.6).
          allowedMethods: [s3.HttpMethods.PUT],
          allowedOrigins: [`https://${cfg.domainName}`],
          allowedHeaders: [
            'content-type',
            'content-md5',
            'x-amz-checksum-sha256',
            'x-amz-sdk-checksum-algorithm',
          ],
          maxAge: 3600,
        },
      ],
      lifecycleRules: [
        { prefix: 'incoming/', expiration: Duration.days(2) },
        { prefix: 'quarantine/', expiration: Duration.days(90) },
        { noncurrentVersionExpiration: Duration.days(90) },
        { abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
      removalPolicy: removal,
      autoDeleteObjects: !isProd,
    });

    // ── Antivirus: GuardDuty escanea todo lo que cae en incoming/ ────────────
    const scanRole = new iam.Role(this, 'MalwareScanRole', {
      assumedBy: new iam.ServicePrincipal('malware-protection-plan.guardduty.amazonaws.com'),
    });
    scanRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          's3:GetObject',
          's3:GetObjectVersion',
          's3:GetObjectTagging',
          's3:PutObjectTagging',
          's3:PutObjectVersionTagging',
          's3:GetObjectVersionTagging',
        ],
        resources: [this.docsBucket.arnForObjects('*')],
      }),
    );
    scanRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          's3:ListBucket',
          's3:GetBucketNotification',
          's3:PutBucketNotification',
          's3:GetBucketLocation',
        ],
        resources: [this.docsBucket.bucketArn],
      }),
    );
    scanRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'events:PutRule',
          'events:DeleteRule',
          'events:PutTargets',
          'events:RemoveTargets',
          'events:DescribeRule',
          'events:ListTargetsByRule',
        ],
        resources: [
          `arn:aws:events:${this.region}:${this.account}:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*`,
        ],
      }),
    );
    scanRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
        resources: ['*'],
        conditions: { StringLike: { 'kms:ViaService': `s3.${this.region}.amazonaws.com` } },
      }),
    );
    const plan = new guardduty.CfnMalwareProtectionPlan(this, 'MalwarePlan', {
      role: scanRole.roleArn,
      protectedResource: {
        s3Bucket: { bucketName: this.docsBucket.bucketName, objectPrefixes: ['incoming/'] },
      },
      actions: { tagging: { status: 'ENABLED' } },
    });
    plan.node.addDependency(scanRole);

    // ── Cola de ingesta con reintentos y cola de errores ─────────────────────
    this.ingestDlq = new sqs.Queue(this, 'IngestDlq', {
      queueName: name(cfg, 'ingest-dlq'),
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
    });
    this.ingestQueue = new sqs.Queue(this, 'IngestQueue', {
      queueName: name(cfg, 'ingest'),
      // ≥ 6 × timeout del worker (recomendación de AWS para orígenes SQS de Lambda).
      visibilityTimeout: Duration.minutes(90),
      retentionPeriod: Duration.days(4),
      enforceSSL: true,
      deadLetterQueue: { queue: this.ingestDlq, maxReceiveCount: 3 },
    });

    // El resultado del escaneo (limpio o con amenaza) llega por EventBridge.
    new events.Rule(this, 'ScanResult', {
      eventPattern: {
        source: ['aws.guardduty'],
        detailType: ['GuardDuty Malware Protection Object Scan Result'],
        detail: { s3ObjectDetails: { bucketName: [this.docsBucket.bucketName] } },
      },
      targets: [new targets.SqsQueue(this.ingestQueue)],
    });

    new cloudwatch.Alarm(this, 'IngestDlqNotEmpty', {
      alarmName: name(cfg, 'ingest-dlq-not-empty'),
      metric: this.ingestDlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(
      new cwActions.SnsAction(sns.Topic.fromTopicArn(this, 'Alerts', alertsTopicArn(cfg))),
    );
  }
}
```

```ts
// infra/lib/alerts-stack.ts
import { Stack, type StackProps } from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';
import type { StageConfig } from './config';
import { name } from './naming';

/** Primer stack de cada stage: el tema de alarmas y el presupuesto mensual. */
export class AlertsStack extends Stack {
  constructor(scope: Construct, id: string, cfg: StageConfig, props: StackProps) {
    super(scope, id, props);

    const topic = new sns.Topic(this, 'Alerts', {
      topicName: name(cfg, 'alerts'),
      enforceSSL: true,
    });
    topic.addSubscription(new subs.EmailSubscription(cfg.alertEmail));
    // Para Slack/Teams: suscribir AWS Chatbot (Amazon Q Developer in chat applications) a este tema.

    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: name(cfg, 'monthly'),
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: cfg.monthlyBudgetUsd, unit: 'USD' },
        costFilters: { TagKeyValue: [`user:stage$${cfg.stage}`] },
      },
      notificationsWithSubscribers: [80, 100].map((threshold) => ({
        notification: {
          notificationType: threshold === 100 ? 'FORECASTED' : 'ACTUAL',
          comparisonOperator: 'GREATER_THAN',
          threshold,
          thresholdType: 'PERCENTAGE',
        },
        subscribers: [{ subscriptionType: 'EMAIL', address: cfg.alertEmail }],
      })),
    });
  }
}
```

```ts
// infra/lib/migrator-stack.ts
import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import type { StageConfig } from './config';
import { DB_NAME, type DataStack } from './data-stack';
import { lambdaDefaults } from './lambda-defaults';
import { paramPath } from './naming';

/**
 * Lambda de operaciones de base de datos (migraciones, roles, seeds, alta de
 * admins). Stack propio para que el CI la actualice e INVOQUE antes de
 * publicar el código nuevo de la API (17.4).
 */
export class MigratorStack extends Stack {
  readonly fn: lambda.Function;

  constructor(
    scope: Construct,
    id: string,
    cfg: StageConfig,
    deps: { vpc: ec2.IVpc; data: DataStack; userPool: cognito.IUserPool },
    props: StackProps,
  ) {
    super(scope, id, props);

    this.fn = new lambda.Function(this, 'Migrator', {
      ...lambdaDefaults(this, cfg, 'migrator'),
      memorySize: 512,
      timeout: Duration.minutes(5),
      vpc: deps.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [deps.data.migratorSg],
      // Nadie la invoca en paralelo: una migración a la vez.
      reservedConcurrentExecutions: 1,
      environment: {
        STAGE: cfg.stage,
        DB_MASTER_SECRET_ARN: deps.data.instance.secret!.secretArn,
        DB_NAME,
        DB_SSL: 'true',
        DB_APP_USER_IAM: 'true',
        COGNITO_USER_POOL_ID: deps.userPool.userPoolId,
        // Carga los CA de Amazon (incluido el de RDS) que el runtime trae en disco
        // pero no activa por defecto desde Node 20.
        NODE_EXTRA_CA_CERTS: '/var/runtime/ca-cert.pem',
      },
    });
    deps.data.instance.secret!.grantRead(this.fn);
    this.fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminAddUserToGroup',
        ],
        resources: [deps.userPool.userPoolArn],
      }),
    );

    new ssm.StringParameter(this, 'MigratorName', {
      parameterName: paramPath(cfg, 'migrator-function'),
      stringValue: this.fn.functionName,
    });
  }
}
```

Documentos: bucket cifrado con KMS propia del stage, bloqueo de acceso público, versionado, lifecycle que aborta multipart a los 7 días y expira los objetos en `incoming/` que nadie llegó a confirmar. El bucket de logs recibe los access logs de CloudFront y del bucket de documentos.

GuardDuty Malware Protection es un `CfnMalwareProtectionPlan` sobre el prefijo `incoming/`. El resultado no dispara la Lambda: pasa por EventBridge y SQS. La cola tiene DLQ, `maxReceiveCount: 3`, visibilidad de 90 minutos, y una alarma de "hay mensajes en la DLQ" publicada en el topic de alertas.

Ese topic es `<app-short>-<stage>-alerts`. Su ARN se **calcula**, no se exporta, para que la API y el borde puedan suscribir alarmas sin una dependencia de stack circular. La suscripción de email es `<ALERT_EMAIL>`. El presupuesto mensual (`monthlyBudgetUsd` en la config) publica en el mismo topic al 80 % y al 100 %.

El migrator es una Lambda dentro de la VPC, sin URL pública, con permiso de leer el secreto del maestro, de `rds-db:connect` como `postgres` no aplica (entra con contraseña a la instancia) y de `AdminCreateUser` / `AdminAddUserToGroup` / `AdminGetUser` sobre el pool del stage. El grupo de seguridad de RDS acepta su tráfico en el puerto 5432.

### 16.7 API

```ts
// infra/lib/lambda-defaults.ts
import * as path from 'node:path';
import { Duration } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import type { StageConfig } from './config';
import { name } from './naming';

/** Bundle precompilado por `pnpm bundle` (6.11). El mismo artefacto se promueve dev → qa → prod. */
export const lambdaCode = (fn: string) =>
  lambda.Code.fromAsset(path.join(__dirname, '..', '..', '.lambda', fn), { exclude: ['*.map'] });

/** Propiedades comunes a todas las Lambdas del proyecto. */
export function lambdaDefaults(scope: Construct, cfg: StageConfig, fn: string) {
  return {
    functionName: name(cfg, fn),
    runtime: lambda.Runtime.NODEJS_24_X,
    architecture: lambda.Architecture.ARM_64,
    handler: 'index.handler',
    code: lambdaCode(fn),
    tracing: lambda.Tracing.ACTIVE,
    loggingFormat: lambda.LoggingFormat.JSON,
    logGroup: new logs.LogGroup(scope, `${fn}Logs`, {
      logGroupName: `/aws/lambda/${name(cfg, fn)}`,
      retention: cfg.logRetentionDays,
    }),
    timeout: Duration.seconds(29),
  } satisfies Partial<lambda.FunctionProps>;
}
```

```ts
// infra/lib/api-stack.ts
import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import type { StageConfig } from './config';
import { APP_DB_USER, DB_NAME, type DataStack } from './data-stack';
import { lambdaDefaults } from './lambda-defaults';
import { alertsTopicArn, docsBucketName, ingestQueueArn, name, paramPath } from './naming';

export interface ApiDeps {
  vpc: ec2.IVpc;
  data: DataStack;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  clientSecret: secretsmanager.ISecret;
}

export class ApiStack extends Stack {
  readonly httpApi: apigw.HttpApi;
  readonly originVerifySecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, cfg: StageConfig, deps: ApiDeps, props: StackProps) {
    super(scope, id, props);
    const alerts = sns.Topic.fromTopicArn(this, 'Alerts', alertsTopicArn(cfg));
    // Referencias por nombre determinista (sin exports entre stacks, 16.3).
    const docsBucket = s3.Bucket.fromBucketName(this, 'Docs', docsBucketName(cfg));
    const ingestQueue = sqs.Queue.fromQueueArn(this, 'IngestQueue', ingestQueueArn(cfg));
    const ingestDlq = sqs.Queue.fromQueueArn(this, 'IngestDlq', `${ingestQueueArn(cfg)}-dlq`);
    const alarm = (a: cloudwatch.Alarm) => {
      a.addAlarmAction(new cwActions.SnsAction(alerts));
      return a;
    };

    // Cabecera secreta que CloudFront añade a cada petición hacia la API (8.1, 9.10).
    this.originVerifySecret = new secretsmanager.Secret(this, 'OriginVerify', {
      secretName: paramPath(cfg, 'origin-verify'),
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
    });

    const commonEnv = {
      NODE_ENV: 'production',
      STAGE: cfg.stage,
      APP_ORIGIN: `https://${cfg.domainName}`,
      DOCS_BUCKET: docsBucket.bucketName,
      COGNITO_USER_POOL_ID: deps.userPool.userPoolId,
      COGNITO_CLIENT_ID: deps.userPoolClient.userPoolClientId,
      COGNITO_CLIENT_SECRET_ARN: deps.clientSecret.secretArn,
      ORIGIN_VERIFY_SECRET_ARN: this.originVerifySecret.secretArn,
      DB_HOST: deps.data.proxy.endpoint,
      DB_PORT: '5432',
      DB_USERNAME: APP_DB_USER,
      DB_NAME,
      DB_IAM_AUTH: 'true',
      DB_SSL: 'true',
      SENTRY_DSN: cfg.sentryDsn ?? '',
      // El CI lo fija con el SHA del commit: aparece en /api/health, logs y Sentry.
      RELEASE: process.env.RELEASE ?? 'unknown',
    };

    // ── API HTTP ─────────────────────────────────────────────────────────────
    const fn = new lambda.Function(this, 'Api', {
      ...lambdaDefaults(this, cfg, 'api'),
      memorySize: cfg.api.memoryMb,
      vpc: deps.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [deps.data.proxyClientSg],
      environment: commonEnv,
    });
    deps.clientSecret.grantRead(fn);
    this.originVerifySecret.grantRead(fn);
    deps.data.proxy.grantConnect(fn, APP_DB_USER);
    docsBucket.grantReadWrite(fn);
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminDeleteUser'], // solo para el rollback del registro
        resources: [deps.userPool.userPoolArn],
      }),
    );

    // Cada despliegue publica una versión inmutable; el tráfico va al alias `live`.
    const alias = new lambda.Alias(this, 'Live', {
      aliasName: 'live',
      version: fn.currentVersion,
      provisionedConcurrentExecutions: cfg.api.provisionedConcurrency || undefined,
    });

    const errors = alarm(
      new cloudwatch.Alarm(this, 'ApiErrors', {
        alarmName: name(cfg, 'api-errors'),
        metric: alias.metricErrors({ period: Duration.minutes(1) }),
        threshold: cfg.stage === 'prod' ? 5 : 20,
        evaluationPeriods: 2,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
    );

    if (cfg.api.canary) {
      // 10 % del tráfico a la versión nueva durante 5 minutos; si la alarma salta, vuelve sola.
      new codedeploy.LambdaDeploymentGroup(this, 'Canary', {
        alias,
        deploymentConfig: codedeploy.LambdaDeploymentConfig.CANARY_10PERCENT_5MINUTES,
        alarms: [errors],
      });
    }

    this.httpApi = new apigw.HttpApi(this, 'Http', {
      apiName: name(cfg, 'http'),
      defaultIntegration: new HttpLambdaIntegration('ApiIntegration', alias, {
        payloadFormatVersion: apigw.PayloadFormatVersion.VERSION_2_0,
      }),
      createDefaultStage: false,
    });
    new apigw.HttpStage(this, 'DefaultStage', {
      httpApi: this.httpApi,
      stageName: '$default',
      autoDeploy: true,
      throttle: { rateLimit: cfg.api.throttleRatePerSecond, burstLimit: cfg.api.throttleBurst },
      accessLogSettings: {
        destination: new apigw.LogGroupLogDestination(
          new logs.LogGroup(this, 'HttpAccessLogs', {
            retention: cfg.logRetentionDays,
          }),
        ),
      },
    });

    // ── Worker de ingesta (SQS) ──────────────────────────────────────────────
    const worker = new lambda.Function(this, 'IngestWorker', {
      ...lambdaDefaults(this, cfg, 'ingest-worker'),
      memorySize: 1024,
      timeout: Duration.minutes(15),
      vpc: deps.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [deps.data.proxyClientSg],
      environment: commonEnv,
      reservedConcurrentExecutions: 5,
    });
    this.originVerifySecret.grantRead(worker);
    deps.clientSecret.grantRead(worker);
    deps.data.proxy.grantConnect(worker, APP_DB_USER);
    docsBucket.grantReadWrite(worker);
    docsBucket.grantDelete(worker);
    worker.addEventSource(
      new SqsEventSource(ingestQueue, { batchSize: 1, reportBatchItemFailures: true }),
    );

    // ── Alarmas y tablero ────────────────────────────────────────────────────
    const api5xx = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '5xx',
      dimensionsMap: { ApiId: this.httpApi.apiId },
      statistic: 'Sum',
      period: Duration.minutes(1),
    });
    const latencyP95 = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: 'Latency',
      dimensionsMap: { ApiId: this.httpApi.apiId },
      statistic: 'p95',
      period: Duration.minutes(5),
    });
    alarm(
      new cloudwatch.Alarm(this, 'Api5xx', {
        alarmName: name(cfg, 'api-5xx'),
        metric: api5xx,
        threshold: 10,
        evaluationPeriods: 3,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
    );
    alarm(
      new cloudwatch.Alarm(this, 'ApiLatency', {
        alarmName: name(cfg, 'api-latency-p95'),
        metric: latencyP95,
        threshold: 1000,
        evaluationPeriods: 3,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
    );
    alarm(
      new cloudwatch.Alarm(this, 'ApiThrottles', {
        alarmName: name(cfg, 'api-throttles'),
        metric: alias.metricThrottles({ period: Duration.minutes(5) }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
    );
    alarm(
      new cloudwatch.Alarm(this, 'DbCpu', {
        alarmName: name(cfg, 'db-cpu'),
        metric: deps.data.instance.metricCPUUtilization({ period: Duration.minutes(5) }),
        threshold: 80,
        evaluationPeriods: 3,
      }),
    );
    alarm(
      new cloudwatch.Alarm(this, 'DbStorage', {
        alarmName: name(cfg, 'db-free-storage'),
        metric: deps.data.instance.metricFreeStorageSpace({ period: Duration.minutes(15) }),
        threshold: 5 * 1024 ** 3,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        evaluationPeriods: 1,
      }),
    );

    new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: name(cfg, 'overview'),
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: 'API: peticiones y 5xx',
            left: [api5xx],
            right: [alias.metricInvocations()],
          }),
          new cloudwatch.GraphWidget({ title: 'API: latencia p95 (ms)', left: [latencyP95] }),
          new cloudwatch.GraphWidget({
            title: 'Lambda: errores y throttles',
            left: [alias.metricErrors(), alias.metricThrottles()],
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: 'Lambda: duración p95',
            left: [alias.metricDuration({ statistic: 'p95' })],
          }),
          new cloudwatch.GraphWidget({
            title: 'RDS: CPU',
            left: [deps.data.instance.metricCPUUtilization()],
          }),
          new cloudwatch.GraphWidget({
            title: 'RDS: conexiones',
            left: [deps.data.instance.metricDatabaseConnections()],
          }),
        ],
        [
          new cloudwatch.GraphWidget({
            title: 'Ingesta: cola y DLQ',
            left: [ingestQueue.metricApproximateNumberOfMessagesVisible()],
            right: [ingestDlq.metricApproximateNumberOfMessagesVisible()],
          }),
        ],
      ],
    });

    new ssm.StringParameter(this, 'ApiFunctionName', {
      parameterName: paramPath(cfg, 'api-function'),
      stringValue: fn.functionName,
    });
  }
}
```

HTTP API (no REST API): menos latencia y menos coste, y suficiente porque la autorización no la hace API Gateway, la hace la aplicación. El throttling del stage es el de `config` (`throttleRatePerSecond`, `throttleBurst`). Access logs en JSON al grupo de CloudWatch, con `requestId` y `sourceIp`.

La Lambda de la API tiene alias `live`. API Gateway integra con el alias, no con `$LATEST`. En prod hay un despliegue CodeDeploy canary (10 % durante 5 minutos) que se revierte solo si salta la alarma de 5xx. En dev y qa el alias se mueve directo: el ciclo de feedback importa más que el canary. Concurrencia provisionada según config (0 fuera de prod, 2 en prod) para quitar el cold start del alias.

`NODE_EXTRA_CA_CERTS` apunta al bundle de CA que el stack empaqueta. Sin eso, `ssl.rejectUnauthorized: true` contra RDS Proxy falla con `self-signed certificate in certificate chain` porque el certificado del proxy está firmado por la CA de Amazon RDS, que no está en el trust store por defecto de Node.

Variables de entorno de la función: todo lo no secreto (`STAGE`, `APP_ORIGIN`, ids de Cognito, nombre del bucket, host del **proxy**) y los ARNs de los dos secretos. Nunca el secreto.

Alarmas de esta función: 5xx del API, p95 de latencia, throttles. Dashboard con las cuatro gráficas que se miran en una incidencia: peticiones, errores, latencia, conexiones del proxy.

### 16.8 Borde: WAF, CloudFront, DNS

```ts
// infra/lib/edge-stack.ts
import { Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import type { Construct } from 'constructs';
import type { StageConfig } from './config';
import { name } from './naming';

/**
 * Recursos que CloudFront exige en us-east-1, sea cual sea <REGION>:
 * el certificado TLS y el Web ACL de WAF.
 */
export class EdgeStack extends Stack {
  readonly certificate: acm.Certificate;
  readonly webAclArn: string;

  constructor(scope: Construct, id: string, cfg: StageConfig, props: StackProps) {
    super(scope, id, props);

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: cfg.hostedZoneId,
      zoneName: cfg.hostedZoneName,
    });
    this.certificate = new acm.Certificate(this, 'Cert', {
      domainName: cfg.domainName,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    const managed = (priority: number, ruleName: string, countOnly: string[] = []) => ({
      name: ruleName,
      priority,
      overrideAction: { none: {} },
      statement: {
        managedRuleGroupStatement: {
          vendorName: 'AWS',
          name: ruleName,
          ruleActionOverrides: countOnly.map((r) => ({ name: r, actionToUse: { count: {} } })),
        },
      },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        sampledRequestsEnabled: true,
        metricName: ruleName,
      },
    });
    const rateLimit = (priority: number, ruleName: string, limit: number, pathPrefix?: string) => ({
      name: ruleName,
      priority,
      action: { block: {} },
      statement: {
        rateBasedStatement: {
          limit,
          evaluationWindowSec: 300,
          aggregateKeyType: 'IP',
          ...(pathPrefix
            ? {
                scopeDownStatement: {
                  byteMatchStatement: {
                    fieldToMatch: { uriPath: {} },
                    positionalConstraint: 'STARTS_WITH',
                    searchString: pathPrefix,
                    textTransformations: [{ priority: 0, type: 'NONE' }],
                  },
                },
              }
            : {}),
        },
      },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        sampledRequestsEnabled: true,
        metricName: ruleName,
      },
    });

    const acl = new wafv2.CfnWebACL(this, 'WebAcl', {
      name: name(cfg, 'web-acl'),
      scope: 'CLOUDFRONT',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        sampledRequestsEnabled: true,
        metricName: name(cfg, 'web-acl'),
      },
      rules: [
        // Fuerza bruta contra login, registro y recuperación: 100 peticiones / 5 min / IP.
        rateLimit(0, 'AuthRateLimit', 100, '/api/auth/'),
        // Límite general generoso: frena scraping y abusos sin molestar a un usuario real.
        rateLimit(1, 'GlobalRateLimit', 3000),
        managed(10, 'AWSManagedRulesAmazonIpReputationList'),
        // SizeRestrictions_BODY bloquea cuerpos > 8 KB: demasiado estricto para una API JSON.
        // Los archivos no pasan por aquí (van a S3 con URL presignada, 13.1).
        managed(20, 'AWSManagedRulesCommonRuleSet', ['SizeRestrictions_BODY']),
        managed(30, 'AWSManagedRulesKnownBadInputsRuleSet'),
        managed(40, 'AWSManagedRulesSQLiRuleSet'),
      ],
    });
    this.webAclArn = acl.attrArn;
  }
}
```

```ts
// infra/lib/web-stack.ts
import { Duration, RemovalPolicy, Stack, type StackProps, Validations } from 'aws-cdk-lib';
import type * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import type { StageConfig } from './config';
import { logsBucketName, name, paramPath } from './naming';

export interface WebDeps {
  certificate: acm.ICertificate;
  webAclArn: string;
  apiId: string;
  originVerifySecret: secretsmanager.ISecret;
}

/** Rutas sin extensión (/clientes/42) → /index.html. Las de archivos (/_nuxt/a.js) pasan tal cual. */
const SPA_ROUTER = `function handler(event) {
  var request = event.request;
  if (request.uri.indexOf('.') === -1) { request.uri = '/index.html'; }
  return request;
}`;

/**
 * Un solo dominio para el frontend y la API (2.1, ADR-03):
 *   /*      → S3 (sitio estático)
 *   /api/*  → API Gateway, sin caché, con cookies y la cabecera secreta de origen
 */
export class WebStack extends Stack {
  constructor(scope: Construct, id: string, cfg: StageConfig, deps: WebDeps, props: StackProps) {
    super(scope, id, props);
    const isProd = cfg.stage === 'prod';

    const logsBucket = s3.Bucket.fromBucketName(this, 'Logs', logsBucketName(cfg));
    // El permiso de escritura de logs lo declara StorageStack sobre su propio bucket.
    Validations.of(this).acknowledge({
      id: 'Construct-Annotations::@aws-cdk/aws-s3:accessLogsPolicyNotAdded',
      reason:
        'La política del bucket de logs (StorageStack) ya autoriza a logging.s3.amazonaws.com para el bucket web.',
    });

    const site = new s3.Bucket(this, 'Site', {
      bucketName: `${name(cfg, 'web')}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      serverAccessLogsBucket: logsBucket,
      serverAccessLogsPrefix: 'web/',
      lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(30) }],
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      responseHeadersPolicyName: name(cfg, 'security-headers'),
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(730),
          includeSubdomains: true,
          preload: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        // Directivas que solo funcionan por cabecera. El resto de la CSP (script-src con
        // los hashes de los scripts en línea) la inyecta el build del frontend como <meta>.
        contentSecurityPolicy: {
          contentSecurityPolicy:
            "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; upgrade-insecure-requests",
          override: true,
        },
      },
      customHeadersBehavior: {
        customHeaders: [
          {
            header: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
            override: true,
          },
        ],
      },
    });

    const apiOriginRequest = new cloudfront.OriginRequestPolicy(this, 'ApiOriginRequest', {
      originRequestPolicyName: name(cfg, 'api-origin-request'),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      // Máximo 10 cabeceras por política. Nunca reenviar Host (API Gateway necesita el suyo).
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
        'Accept',
        'Content-Type',
        'Origin',
        'User-Agent',
        'X-Request-Id',
        'Sec-Fetch-Site',
        'Sec-Fetch-Mode',
        'CloudFront-Viewer-Address',
        'CloudFront-Viewer-Country',
      ),
    });

    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      comment: name(cfg, 'cdn'),
      domainNames: [cfg.domainName],
      certificate: deps.certificate,
      webAclId: deps.webAclArn,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      defaultRootObject: 'index.html',
      ...(cfg.geoAllowList.length
        ? { geoRestriction: cloudfront.GeoRestriction.allowlist(...cfg.geoAllowList) }
        : {}),
      enableLogging: true,
      logBucket: logsBucket,
      logFilePrefix: 'cloudfront/',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(site),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        compress: true,
        functionAssociations: [
          {
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            function: new cloudfront.Function(this, 'SpaRouter', {
              code: cloudfront.FunctionCode.fromInline(SPA_ROUTER),
              runtime: cloudfront.FunctionRuntime.JS_2_0,
            }),
          },
        ],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.HttpOrigin(
            `${deps.apiId}.execute-api.${this.region}.${this.urlSuffix}`,
            {
              protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
              readTimeout: Duration.seconds(30),
              customHeaders: {
                'x-origin-verify': deps.originVerifySecret.secretValue.unsafeUnwrap(),
              },
            },
          ),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: apiOriginRequest,
          compress: true,
        },
      },
      // Sin errorResponses 403/404 → index.html: se aplicarían también a /api/* y
      // convertirían los 404 de la API en un 200 con HTML. El enrutado SPA lo hace SPA_ROUTER.
    });

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: cfg.hostedZoneId,
      zoneName: cfg.hostedZoneName,
    });
    const target = route53.RecordTarget.fromAlias(
      new route53Targets.CloudFrontTarget(distribution),
    );
    new route53.ARecord(this, 'AliasA', { zone, recordName: cfg.domainName, target });
    new route53.AaaaRecord(this, 'AliasAAAA', { zone, recordName: cfg.domainName, target });

    // Salidas que consume el pipeline del frontend (16.9).
    new ssm.StringParameter(this, 'WebBucket', {
      parameterName: paramPath(cfg, 'web/bucket-name'),
      stringValue: site.bucketName,
    });
    new ssm.StringParameter(this, 'WebDistribution', {
      parameterName: paramPath(cfg, 'web/distribution-id'),
      stringValue: distribution.distributionId,
    });
    new ssm.StringParameter(this, 'WebUrl', {
      parameterName: paramPath(cfg, 'web/url'),
      stringValue: `https://${cfg.domainName}`,
    });
  }
}
```

El certificado ACM y el WAF están en `us-east-1` aunque el resto del stack viva en `<REGION>`. CloudFront lo exige. Son stacks aparte, con `env.region` fijo, y `crossRegionReferences` no hace falta porque los identificadores que cruzan (ARN del WAF, ARN del certificado, dominio del API) se pasan como valores construidos, no como exports.

WAF, scope `CLOUDFRONT`:

- AWS Managed Rules: Common, Known Bad Inputs, IP Reputation, Anonymous IP.
- `SizeRestrictions_BODY` de Common se pasa a `count`. El cuerpo de la API es JSON pequeño, pero la regla también inspecciona lo que no debe bloquear un upload legítimo que se cuela por el mismo origen, y un falso positivo aquí tira el login sin un mensaje útil. El tamaño de verdad lo limita API Gateway y el DTO (20 MiB en documentos, y ese PUT va a S3, no a la API).
- Rate limit: 100 peticiones / 5 min por IP sobre el path `/api/auth/`, y 3000 / 5 min global.
- Si `geoAllowList` tiene países, una regla permite solo esos y bloquea el resto.

CloudFront:

- Origen del bucket del sitio (OAC, el bucket no es público) para el behavior por defecto.
- Origen del HTTP API para `/api/*`, con la cabecera `x-origin-verify` inyectada por CloudFront y **no** reenviada desde el visor. `AllViewerExceptHostHeader` más esa cabecera.
- HTTP/2 y HTTP/3.
- CloudFront Function en viewer-request: si la URI no tiene extensión, la reescribe a `/index.html`. Es la forma de que el SPA enrute. **No** se usan custom error responses 403/404 → `/index.html`: esa regla también reescribiría un 404 de la API y el frontend no podría distinguir "no existe" de "aquí tienes el HTML".
- Response headers policy: HSTS, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Permissions-Policy` vacía de sensores, y no se cachea `/api/*`.
- Registros A y AAAA en la zona `<HOSTED_ZONE_ID>` hacia la distribución. El nombre es el `domainName` del stage.

Salidas SSM, todas bajo `/<org>/<app-short>/<stage>/`:

| Clave | Para quién |
|---|---|
| `web/bucket-name` | El pipeline del frontend, al sincronizar el build |
| `web/distribution-id` | La invalidación de CloudFront |
| `web/url` | El smoke test y el Environment de GitHub |

### 16.9 CI en la cuenta

```ts
// infra/lib/ci-stack.ts
import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import { GITHUB, type Stage } from './config';
import { APP, ORG } from './naming';

/**
 * Uno por cuenta AWS. Lo despliega una persona con credenciales de
 * administrador, una sola vez (3.2). Crea el proveedor OIDC de GitHub y los
 * roles que asumen los pipelines. La confianza se restringe por repositorio
 * Y por GitHub Environment: solo un job del environment `prod` (que exige
 * aprobación manual) puede asumir el rol de prod.
 */
export class CiStack extends Stack {
  constructor(scope: Construct, id: string, stages: Stage[], props: StackProps) {
    super(scope, id, props);

    const provider = new iam.OpenIdConnectProvider(this, 'GitHubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    const trust = (repo: string) =>
      new iam.WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        'ForAnyValue:StringEquals': {
          'token.actions.githubusercontent.com:sub': stages.map(
            (stage) => `repo:${GITHUB.org}/${repo}:environment:${stage}`,
          ),
        },
      });
    const params = `arn:aws:ssm:*:${this.account}:parameter/${ORG}/${APP}/*`;

    // ── Backend: despliega con CDK e invoca el migrator ──────────────────────
    const backend = new iam.Role(this, 'BackendDeploy', {
      roleName: `${APP}-github-backend-deploy`,
      assumedBy: trust(GITHUB.backendRepo),
      maxSessionDuration: Duration.hours(1),
    });
    backend.addToPolicy(
      new iam.PolicyStatement({
        // CDK no despliega con este rol: asume los roles que creó `cdk bootstrap`
        // (deploy, file-publishing, lookup). Así este rol no necesita permisos de infraestructura.
        actions: ['sts:AssumeRole', 'sts:TagSession'],
        resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*`],
      }),
    );
    backend.addToPolicy(
      new iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [`arn:aws:lambda:*:${this.account}:function:${APP}-*-migrator`],
      }),
    );
    backend.addToPolicy(
      new iam.PolicyStatement({ actions: ['ssm:GetParameter'], resources: [params] }),
    );

    // ── Frontend: sube el sitio estático e invalida index.html ──────────────
    const frontend = new iam.Role(this, 'FrontendDeploy', {
      roleName: `${APP}-github-frontend-deploy`,
      assumedBy: trust(GITHUB.frontendRepo),
      maxSessionDuration: Duration.hours(1),
    });
    frontend.addToPolicy(
      new iam.PolicyStatement({ actions: ['ssm:GetParameter'], resources: [params] }),
    );
    frontend.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [`arn:aws:s3:::${APP}-*-web-${this.account}`],
      }),
    );
    frontend.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject', 's3:DeleteObject', 's3:GetObject'],
        resources: [`arn:aws:s3:::${APP}-*-web-${this.account}/*`],
      }),
    );
    frontend.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudfront:CreateInvalidation', 'cloudfront:GetInvalidation'],
        resources: [`arn:aws:cloudfront::${this.account}:distribution/*`],
        conditions: { StringEquals: { 'aws:ResourceTag/app': APP } },
      }),
    );
  }
}
```

Un proveedor OIDC de GitHub por cuenta y dos roles:

- `<app-short>-github-backend-deploy`, que solo se puede asumir desde `repo:<GITHUB_ORG>/<app>:environment:<stage>` de los stages que viven en esa cuenta.
- `<app-short>-github-frontend-deploy`, igual para el repositorio del frontend, con permiso únicamente de `s3:PutObject`/`DeleteObject` sobre el bucket web y `cloudfront:CreateInvalidation` sobre la distribución.

El subject de OIDC es el **environment**, no la rama. Por eso qa y prod pueden exigir revisores en GitHub y, a la vez, el role no se puede asumir desde un pull request.

### 16.10 Hallazgos de cdk-nag que se aceptan

```ts
// infra/lib/nag.ts
import { Aspects, type IAspect, Stack, Validations } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { IConstruct } from 'constructs';
// Misma normalización que usa la regla IAM5 para construir el id de cada hallazgo.
import { flattenCfnReference } from 'cdk-nag/lib/utils/flatten-cfn-reference';
import type { StageConfig } from './config';

/**
 * Hallazgos de cdk-nag (AwsSolutions) aceptados a propósito, con su razón.
 * Todo lo que no está aquí es un error de síntesis: el CI falla (17.3).
 * Revisar esta lista en cada auditoría; no añadir entradas sin explicación.
 */
export function acknowledgeNagFindings(stacks: Stack[], cfg: StageConfig): void {
  const ack = (id: string, reason: string) =>
    stacks.forEach((s) => Validations.of(s).acknowledge({ id, reason }));

  for (const managed of [
    'AWSLambdaBasicExecutionRole',
    'AWSLambdaVPCAccessExecutionRole',
    'AWSCodeDeployRoleForLambdaLimited',
  ]) {
    ack(
      `AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/${managed}]`,
      'Política gestionada de AWS mínima (logs y ENIs de VPC de Lambda; CodeDeploy limitado a Lambda para el canary). Es la recomendada por AWS.',
    );
  }
  ack(
    'AwsSolutions-SMG4',
    'Secreto del App Client de Cognito y secreto de origen de CloudFront: sin rotación automática nativa. Procedimiento de rotación manual en 23.6.',
  );
  ack(
    'AwsSolutions-RDS11',
    'Puerto por defecto de PostgreSQL: la base no tiene ruta a internet y solo admite tráfico de los security groups del proxy y del migrator.',
  );
  ack(
    'AwsSolutions-APIG4',
    'La autorización se hace en la aplicación (JwtAuthGuard + RolesGuard). API Gateway solo acepta tráfico de CloudFront (cabecera secreta) detrás de WAF.',
  );
  if (cfg.stage !== 'prod') {
    ack('AwsSolutions-RDS3', 'Multi-AZ solo en prod (decisión de costo para dev/qa).');
    ack(
      'AwsSolutions-RDS10',
      'Protección contra borrado solo en prod: dev/qa se recrean desde cero.',
    );
  }
  if (cfg.auth.featurePlan !== 'PLUS') {
    ack(
      'AwsSolutions-COG8',
      'Plan ESSENTIALS elegido por costo; la protección contra fuerza bruta la da WAF (límite en /api/auth/*). Pasar a PLUS si el riesgo lo justifica (Anexo A).',
    );
  }
  if (!cfg.geoAllowList.length) {
    ack(
      'AwsSolutions-CFR1',
      'Sin restricción geográfica: pendiente de decisión de negocio (Anexo A). Configurable con geoAllowList.',
    );
  }
}

const IAM5_REASON =
  'Comodines generados por los grant*() de CDK y acotados al recurso: objetos de un bucket concreto (bucket/*), ' +
  'X-Ray (no admite ARN de recurso), KMS condicionado a kms:ViaService y reglas de GuardDuty por prefijo. ' +
  'Revisado en la auditoría de 23.7; un comodín sobre "*" con acciones de escritura debe justificarse aparte.';

/**
 * cdk-nag 3 exige reconocer cada comodín de IAM5 por separado ("AwsSolutions-IAM5[Action::s3:List*]").
 * Este Aspect calcula esos ids con la misma lógica que la regla y los reconoce con IAM5_REASON.
 * Las demás reglas siguen bloqueando la síntesis.
 */
class AcknowledgeIamWildcards implements IAspect {
  visit(node: IConstruct): void {
    if (!(node instanceof iam.CfnPolicy || node instanceof iam.CfnManagedPolicy)) return;
    const doc = Stack.of(node).resolve(node.policyDocument) as {
      Statement?: Array<Record<string, unknown>>;
    };
    const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
    for (const st of doc.Statement ?? []) {
      if (st.Effect !== 'Allow') continue;
      const findings = [
        ...list(st.Action)
          .filter((a): a is string => typeof a === 'string' && a.includes('*'))
          .map((a) => `Action::${a}`),
        ...list(st.Resource)
          .map((r) => flattenCfnReference(r))
          .filter((r) => r.includes('*'))
          .map((r) => `Resource::${r}`),
      ];
      for (const f of findings)
        Validations.of(node).acknowledge({ id: `AwsSolutions-IAM5[${f}]`, reason: IAM5_REASON });
    }
  }
}

export function acknowledgeIamWildcards(stacks: Stack[]): void {
  stacks.forEach((s) => Aspects.of(s).add(new AcknowledgeIamWildcards()));
}
```

Cada aceptación lleva el id del hallazgo y la razón. Las que hay, y por qué no se "arreglan" quitando la línea:

| Id | Qué es | Por qué se acepta |
|---|---|---|
| `IAM4` | Políticas gestionadas de AWS (`AWSLambdaBasicExecutionRole`, `AWSLambdaVPCAccessExecutionRole`, la de CodeDeploy en prod) | Reescribirlas a mano duplica un documento que AWS mantiene. El id del hallazgo contiene el placeholder literal `<AWS::Partition>`: hay que copiarlo así, no sustituirlo por `aws` |
| `IAM5` | Algún `Resource: "*"` que CDK genera en logs y en X-Ray | Un Aspect recorre el template y emite la aceptación por cada recurso, usando la misma función con la que cdk-nag aplana las referencias. Aceptar "el stack entero" no casa con el id, que incluye la ruta del recurso |
| `SMG4` | El secreto de Cognito y el de `x-origin-verify` no rotan solos | Rotarlos exige un paso en la aplicación (el client secret de Cognito no lo rota Secrets Manager contra el user pool). Rotación manual documentada, no una Lambda de rotación a medias |
| `RDS11` | Puerto 5432 por defecto | Cambiarlo no aporta con el security group cerrado a dos orígenes, y rompe todos los ejemplos y el health check |
| `APIG4` | La ruta no tiene autorizador de API Gateway | La autorización es el JWT de la cookie, validado en la app, porque el autorizador de API Gateway no lee esa cookie con la misma semántica |
| `COG8` | Plan Essentials en lugar de Plus | Decisión de coste (Anexo A). El switch está en `config.ts` |
| `CFR1` | CloudFront sin restricción geográfica | `geoAllowList` vacío hasta que negocio diga los países |
| `RDS3`, `RDS10` | Sin Multi-AZ y sin deletion protection | Solo se aceptan en dev y qa. En prod el synth no los acepta: la config los enciende |

`AwsSolutionsChecks` se registra con `Validations.of(app).addPlugins(...)`. En cdk-nag 3 **ya no es un Aspect** (`visit` no existe); añadirlo con `Aspects.of` falla al sintetizar.

### 16.11 Synth sin cuenta

```bash
# scripts/synth-check.sh
#!/usr/bin/env bash
# Sintetiza infra/ con valores ficticios en lugar de los marcadores (verificación sin AWS).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf infra-synth && mkdir infra-synth
cp -r infra/bin infra/lib infra/cdk.json infra/tsconfig.json infra/package.json infra-synth/
ln -s ../infra/node_modules infra-synth/node_modules
REGION="${REGION:-sa-east-1}"
grep -rl '<' infra-synth/bin infra-synth/lib | xargs sed -i "s/<REGION>/${REGION}/g; s/<HOSTED_ZONE_ID>/Z0123456789ABCDEFGHIJ/g; s/<DOMINIO_BASE>/example.com/g; s/<ALERT_EMAIL>/alerts@example.com/g; s#<SENTRY_DSN_BACKEND>#https://public@o0.ingest.sentry.io/0#g; s/<GITHUB_ORG>/ANKASAFI/g; s/<app-frontend>/propia-frontend/g; s/<app-short>/propia/g; s/<app_snake>/propia/g; s/<app>/propia-backend/g; s/<org>/anka/g; s/<ACCOUNT_NONPROD>/111111111111/g; s/<ACCOUNT_PROD>/222222222222/g; s/<ROL_A>/Operaciones/g; s/<ROL_B>/Admin/g"
cd infra-synth
npx tsc -p tsconfig.json
export CDK_DISABLE_VERSION_CHECK=1
for stage in dev qa prod; do npx cdk synth --quiet -c stage=$stage -o cdk.out.$stage; done
npx cdk synth --quiet -c ci=nonprod -o cdk.out.ci-nonprod
npx cdk synth --quiet -c ci=prod -o cdk.out.ci-prod
```

Este script es la excepción a la regla de "sustituir marcadores en todo el archivo". La parte **izquierda** de cada `s///` tiene que seguir siendo el texto del marcador (`<org>`, `<app-short>`, …) porque opera sobre una copia de `infra/` que todavía los contiene. La parte derecha son los valores ficticios con los que se verificó este documento. No le pases un reemplazo global de marcadores: convertirías `s/<org>/…` en `s/anka/…` y el script dejaría de encontrar nada.

En el repositorio ya sustituido no hace falta: `pnpm --dir infra cdk synth -c stage=dev` sintetiza directo. En CI se usa esa forma (17.1), porque el código que corre en CI ya tiene las cuentas y el dominio reales.

---
## 17. CI/CD

🆕 **V2.** Un artefacto se construye una vez en el job `verify` y se promueve `dev → qa → prod`. No se recompila por stage. Lo que cambia entre stages es la configuración que CDK lee de `config.ts` y los secretos de cada cuenta.

### 17.1 Verificación

```yaml
# .github/workflows/ci.yml
name: CI/CD

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  # En main no se cancela un despliegue a medias; en PRs sí se cancela la ejecución vieja.
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

jobs:
  verify:
    name: Verificar y construir
    runs-on: ubuntu-latest
    timeout-minutes: 20
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: app_test
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      DB_HOST: localhost
      DB_PORT: '5432'
      DB_USERNAME: postgres
      DB_PASSWORD: postgres
      DB_NAME_TEST: app_test
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm audit --prod --audit-level high
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm test:e2e:cov
      - run: pnpm build && pnpm bundle
      - name: Contrato OpenAPI
        env:
          NODE_ENV: test
          STAGE: test
          APP_ORIGIN: http://127.0.0.1:4200
          DOCS_BUCKET: ci
          COGNITO_USER_POOL_ID: ci
          COGNITO_CLIENT_ID: ci
          COGNITO_CLIENT_SECRET: ci
          DB_NAME: app_test
          OPENAPI_OUT: openapi.json
        run: node dist/main.js
      - name: cdk synth + cdk-nag (los 3 stages)
        working-directory: infra
        run: for s in dev qa prod; do pnpm cdk synth --quiet -c stage=$s -o cdk.out.$s; done
      - uses: actions/upload-artifact@v4
        with:
          name: release-${{ github.sha }}
          path: |
            .lambda/
            openapi.json
          retention-days: 30
          if-no-files-found: error

  deploy-dev:
    if: github.event_name == 'push'
    needs: verify
    uses: ./.github/workflows/deploy.yml
    with:
      stage: dev
      account: '<ACCOUNT_NONPROD>'
    permissions:
      contents: read
      id-token: write

  deploy-qa:
    needs: deploy-dev
    uses: ./.github/workflows/deploy.yml
    with:
      stage: qa
      account: '<ACCOUNT_NONPROD>'
    permissions:
      contents: read
      id-token: write

  deploy-prod:
    needs: deploy-qa
    uses: ./.github/workflows/deploy.yml
    with:
      stage: prod
      account: '<ACCOUNT_PROD>'
    permissions:
      contents: read
      id-token: write
```

El job `verify` corre en cada pull request y en cada push a `main`:

1. `pnpm install --frozen-lockfile`
2. `pnpm audit --prod --audit-level high`
3. lint, typecheck, unitarios
4. e2e con cobertura, contra el servicio `postgres:17`
5. `pnpm build && pnpm bundle`
6. `node dist/main.js` con `OPENAPI_OUT=openapi.json`, que escribe el contrato y sale
7. `cdk synth` de dev, qa y prod dentro de `infra/` (el código de CI ya no tiene marcadores)
8. Sube `.lambda/` y `openapi.json` como artefacto `release-<sha>`, retención 30 días

`cdk synth` en este job exige que los marcadores de `infra/` estén sustituidos. Si se commitea un `<ACCOUNT_NONPROD>` literal, el synth falla aquí, que es lo que se quiere.

CodeQL con el suite `security-extended` en cada PR y los lunes:

```yaml
# .github/workflows/codeql.yml
name: CodeQL

on:
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 6 * * 1'

permissions:
  contents: read
  security-events: write

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: github/codeql-action/init@v3
        with:
          languages: javascript-typescript
          queries: security-extended
      - uses: github/codeql-action/analyze@v3
```

Dependabot, semanal, agrupado para que no abra un PR por cada paquete de `@aws-sdk`:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: { interval: weekly, day: monday }
    open-pull-requests-limit: 10
    groups:
      aws-sdk: { patterns: ['@aws-sdk/*'] }
      nestjs: { patterns: ['@nestjs/*'] }
      cdk: { patterns: ['aws-cdk', 'aws-cdk-lib', 'constructs', 'cdk-nag'] }
      dev-tooling:
        dependency-type: development
        update-types: [minor, patch]
  - package-ecosystem: npm
    directory: /infra
    schedule: { interval: weekly, day: monday }
    groups:
      cdk: { patterns: ['*'] }
  - package-ecosystem: github-actions
    directory: /
    schedule: { interval: weekly, day: monday }
```

`pnpm-workspace.yaml` aprueba los scripts de instalación de `@swc/core` y `esbuild`, y niega el de `@scarf/scarf`. pnpm 12 aborta el install si un paquete quiere correr un script que no está en esa lista (`ERR_PNPM_IGNORED_BUILDS`). Cuando entre una dependencia nueva que necesite compilar, se añade aquí en el mismo PR, no se usa `--ignore-scripts` a ciegas.

### 17.2 Promoción

```yaml
# .github/workflows/deploy.yml
name: Desplegar stage

on:
  workflow_call:
    inputs:
      stage:
        required: true
        type: string
      account:
        required: true
        type: string

permissions:
  contents: read
  id-token: write

jobs:
  deploy:
    name: Desplegar ${{ inputs.stage }}
    runs-on: ubuntu-latest
    # El GitHub Environment define quién aprueba (qa y prod exigen revisores) y
    # es parte de la confianza OIDC: solo este environment puede asumir el rol.
    environment:
      name: ${{ inputs.stage }}
      url: ${{ steps.smoke.outputs.url }}
    timeout-minutes: 45
    concurrency:
      group: deploy-${{ inputs.stage }}
      cancel-in-progress: false
    env:
      STAGE: ${{ inputs.stage }}
      RELEASE: ${{ github.sha }}
      CDK_DISABLE_VERSION_CHECK: '1'
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile --filter infra
      # El MISMO bundle que se verificó en el job `verify`: no se recompila por stage.
      - uses: actions/download-artifact@v5
        with:
          name: release-${{ github.sha }}
      - uses: aws-actions/configure-aws-credentials@v5
        with:
          role-to-assume: arn:aws:iam::${{ inputs.account }}:role/<app-short>-github-backend-deploy
          aws-region: <REGION>
      - name: 1. Infraestructura base y Lambda migrator
        working-directory: infra
        run: |
          P="<app-short>-${STAGE}"
          pnpm cdk deploy -c stage="$STAGE" --require-approval never \
            "$P-alerts" "$P-storage" "$P-migrator"
      - name: 2. Migraciones (antes de publicar el código nuevo)
        run: bash scripts/ci/invoke-migrator.sh "$STAGE" migrate
      - name: 3. API, borde y web (canary en prod)
        working-directory: infra
        run: pnpm cdk deploy -c stage="$STAGE" --require-approval never --all
      - name: 4. Smoke test
        id: smoke
        run: bash scripts/ci/smoke.sh "$STAGE"
```

`dev` arranca solo, al llegar un push a `main`. `qa` espera a que `dev` termine y a que un revisor apruebe el Environment `qa`. `prod` igual con el Environment `prod`. Esos Environments son también el subject OIDC: el job no puede asumir el rol de la cuenta si alguien quita el `environment:` del workflow.

Dentro de un stage, el orden es fijo:

1. `cdk deploy` de `alerts`, `storage` y `migrator`. La alarma existe antes de que haya algo que pueda fallar. El bucket y la cola existen antes de que la API reciba tráfico. El migrator existe antes de que se le invoque.
2. `scripts/ci/invoke-migrator.sh <stage> migrate`. Si la migración falla, el workflow se detiene y el alias `live` sigue apuntando al código viejo, compatible con el esquema viejo.
3. `cdk deploy --all`, que mueve el alias. En prod lo mueve CodeDeploy en canary.
4. `scripts/ci/smoke.sh <stage>`, a través de CloudFront, no contra el API Gateway directo. Así se prueba el secreto de origen, el certificado y el enrutado de `/api/*`.

```bash
# scripts/ci/invoke-migrator.sh
#!/usr/bin/env bash
# Invoca la Lambda migrator del stage y falla si la función devolvió error.
# Uso: bash scripts/ci/invoke-migrator.sh <stage> <migrate|status|seed>
set -euo pipefail
STAGE="${1:?stage}"
ACTION="${2:-migrate}"
FN=$(aws ssm get-parameter --name "/<org>/<app-short>/${STAGE}/migrator-function" --query Parameter.Value --output text)

echo "Invocando ${FN} con action=${ACTION}"
META=$(aws lambda invoke \
  --function-name "$FN" \
  --cli-binary-format raw-in-base64-out \
  --payload "{\"action\":\"${ACTION}\"}" \
  --cli-read-timeout 330 \
  --query '{status: StatusCode, error: FunctionError}' \
  --output json \
  /tmp/migrator-out.json)

echo "Respuesta: $(cat /tmp/migrator-out.json)"
if [ "$(echo "$META" | jq -r '.error // empty')" != "" ]; then
  echo "::error::La Lambda migrator falló. El código nuevo NO se publicó; el esquema y la API siguen como estaban."
  exit 1
fi
```

```bash
# scripts/ci/smoke.sh
#!/usr/bin/env bash
# Comprueba, a través de CloudFront (el camino real del usuario), que el stage responde
# con el release recién desplegado y que las protecciones básicas están activas.
# Uso: bash scripts/ci/smoke.sh <stage>
set -euo pipefail
STAGE="${1:?stage}"
URL=$(aws ssm get-parameter --name "/<org>/<app-short>/${STAGE}/web/url" --query Parameter.Value --output text)
echo "url=${URL}" >> "${GITHUB_OUTPUT:-/dev/null}"

fail() { echo "::error::$1"; exit 1; }

# 1. La API arranca, llega a la base y sirve el release esperado (reintenta: el canary tarda).
for _ in $(seq 1 30); do
  BODY=$(curl -fsS "${URL}/api/health" || true)
  [ "$(echo "$BODY" | jq -r '.release // empty')" = "${RELEASE}" ] && break
  sleep 10
done
echo "health: ${BODY}"
[ "$(echo "$BODY" | jq -r '.release // empty')" = "${RELEASE}" ] || fail "/api/health no sirve el release ${RELEASE}"

# 2. Ruta protegida sin sesión → 401 (la ruta existe y el guard está activo).
CODE=$(curl -s -o /dev/null -w '%{http_code}' "${URL}/api/auth/me")
[ "$CODE" = "401" ] || fail "/api/auth/me devolvió ${CODE}, se esperaba 401"

# 3. El 404 de la API es JSON, no el index.html de la SPA (16.6).
CT=$(curl -s -o /dev/null -w '%{content_type}' "${URL}/api/no-existe")
[[ "$CT" == application/json* ]] || fail "/api/no-existe devolvió ${CT}: CloudFront está reescribiendo errores de la API"

# 4. Una ruta profunda de la SPA devuelve la app (enrutado SPA en CloudFront).
CODE=$(curl -s -o /dev/null -w '%{http_code}' "${URL}/una/ruta/profunda")
[ "$CODE" = "200" ] || fail "La ruta profunda de la SPA devolvió ${CODE}"

# 5. Cabeceras de seguridad del HTML.
HEADERS=$(curl -sI "${URL}/")
echo "$HEADERS" | grep -qi '^strict-transport-security:' || fail "Falta HSTS"
echo "$HEADERS" | grep -qi "^content-security-policy:.*frame-ancestors 'none'" || fail "Falta la CSP de CloudFront"

echo "Smoke test OK en ${URL} (release ${RELEASE})"
```

El smoke exige `GET /api/health` con `status: ok` a través de la URL publicada en SSM (`web/url`). Un 200 del HTML del SPA no cuenta.

### 17.3 Qué hay que crear a mano, una vez

Los GitHub Environments `dev`, `qa` y `prod` en los dos repositorios. `qa` y `prod` con revisores obligatorios. El workflow no los crea.

El stack `ci` de cada cuenta, desplegado desde una sesión con credenciales de administrador de esa cuenta, **antes** del primer `cdk deploy` de un stage:

```
cd infra && pnpm cdk deploy -c ci=nonprod
# en la cuenta de prod, con otro perfil:
pnpm cdk deploy -c ci=prod
```

A partir de ese momento el pipeline asume el rol y no vuelve a hacer falta una clave de larga duración.

---
## 18. Entorno de desarrollo local y Cursor Cloud

### 18.1 Local

Herramientas, las mismas que en CI:

| Herramienta | Versión verificada |
|---|---|
| Node | 24.21.0 (`.nvmrc` pide `24`; `engines` exige `>=24.11.0 <25`) |
| pnpm | 12.10.1, vía `corepack enable && corepack prepare pnpm@12.10.1 --activate` |
| PostgreSQL | 17 |

```
createdb <app_snake>
createdb <app_snake>_test
cp .env.example .env
# rellenar COGNITO_* con el pool de dev, o dejarlos y trabajar solo con la suite
pnpm install
pnpm migration:run
pnpm db:seed
pnpm start:dev
```

La API escucha en `127.0.0.1:3000`. El navegador no llama a ese puerto: llama a `http://127.0.0.1:4200/api/...` y Nuxt hace de proxy (blueprint del frontend). Las cookies salen sin el prefijo `__Host-` porque el origen es HTTP.

Swagger queda en `http://127.0.0.1:3000/docs`. El OpenAPI se regenera con `OPENAPI_OUT=openapi.json node dist/main.js` después de `pnpm build`.

### 18.2 Cursor Cloud

No hay `.cursor/environment.json` en el núcleo: el entorno de nube se define cuando el repositorio ya existe, y un JSON inventado aquí no se pudo ejecutar. Los comandos que el entorno tiene que dejar hechos son los de 18.1 más el servicio de PostgreSQL 17 con el usuario que el `.env` espera (`postgres` / `postgres` en la verificación). Node tiene que ser 24, no el 22 que algunas imágenes traen por defecto: `engines` hace fallar `pnpm install` si no.

El directorio `.local-uploads/` es el bucket falso de local. Está en `.gitignore`.

### 18.3 Lo que local no reproduce

GuardDuty, el WAF, el canary, la rotación del secreto del maestro y el token IAM. Para eso está el stage `dev`, que es barato a propósito (`t4g.micro`, una NAT, sin concurrencia provisionada) y se despliega en cada merge a `main`. No se "prueba en local" el flujo de subida a S3: se prueba el sustituto de disco y, en `dev`, el camino real.

---
## 19. Correcciones obligatorias respecto al original

Estas son deudas del backend del que salió la v1. El código de las secciones anteriores **ya las tiene aplicadas**. Se documentan para que nadie las reintroduzca al "acercar" el proyecto al original.

### 19.1 Guard JWT global y `@Public()`

El original decoraba cada controlador con `@UseGuards(JwtAuthGuard)`. Una ruta nueva nacía pública. Aquí los dos guards son globales y la excepción es `@Public()` (8.4, 9.1).

### 19.2 Las migraciones no corren al arrancar la API

El original llamaba a `runMigrations()` dentro del bootstrap de la Lambda. Dos contenedores arrancando a la vez se pisaban, y un error de migración se veía como un 500 de la API. Ahora solo corre la Lambda `migrator`, invocada por el CI antes de publicar código (11.6, 17.2).

### 19.3 La base no es pública y la API no tiene contraseña

El original exponía RDS a internet con usuario y contraseña en una variable de entorno. Aquí la instancia está en subredes aisladas, la API entra por el proxy con IAM y el único sitio con la contraseña del maestro es el migrator (7.2, 11.3, 16.4).

### 19.4 Un solo prefijo de parámetros

El original usaba `/<org>/<clave>` sin stage para la configuración y otro prefijo distinto para el frontend. Desplegar qa y prod en la misma cuenta era imposible sin pisarse. Todo sale bajo `/<org>/<app-short>/<stage>/` (1.2, 16.8).

### 19.5 Los tres stages existen como código

El original solo tenía stack de CloudFormation de `dev`, y el script de deploy improvisaba los nombres de qa y prod. Los tres están en `config.ts` y los sintetiza el CI (16.2, 17.1).

### 19.6 El runtime de Node es el mismo en todas partes

`.nvmrc`, `engines`, la Lambda y el `target` de esbuild dicen Node 24. El original declaraba 20 en un sitio y 18 en la imagen Docker. Node 20 en Lambda quedó deprecado el 30/04/2026.

### 19.7 No hay lista manual de funciones a publicar

El script del original actualizaba `main` y el worker, y se olvidaba el cron: el código del cron no se desplegaba nunca. CDK despliega todas las funciones que el stack declara (14.3).

### 19.8 Los tests corren en CI contra una base real

El original no tenía suite. El blueprint v1 proponía Jest; esta versión usa Vitest porque el toolchain de Nest 12 y TypeScript 6 se mueve más rápido de lo que Jest estaba siguiendo en el momento de verificar, y SWC emite la metadata de decoradores que esbuild no emite (6.8, 15).

### 19.9 Sin Dockerfile

Ver 6.9.

### 19.10 TLS condicional

`DB_SSL=false` en local, `rejectUnauthorized: true` en AWS, con el bundle de CA de Amazon en `NODE_EXTRA_CA_CERTS` (7.2, 16.7). Forzar TLS contra el PostgreSQL del portátil, o desactivarlo contra RDS, son los dos fallos simétricos.

### 19.11 `gen_random_uuid()`, no `uuid-ossp`

Ver 7.2. La v1 pedía crear `uuid-ossp` en la primera migración. PostgreSQL 17 ya trae `gen_random_uuid()` y `migration:generate` lo emite cuando `uuidExtension` es `pgcrypto`.

### 19.12 La sesión no vive en una cookie que JavaScript pueda leer

El original devolvía los tokens al frontend y el frontend los guardaba. Cualquier XSS era un robo de sesión, y además obligaba a CORS porque el front y la API estaban en orígenes distintos. Cookies `httpOnly` y un solo origen (10, 8.1).

### 19.13 El refresh rota y no depende del email

El original calculaba `SECRET_HASH` del refresh con el email o con el sub, según el caso, y un usuario que cambiaba el email rompía el refresco. `GetTokensFromRefreshToken` recibe el secreto del client en claro de canal (TLS) y no necesita el username (10.4).

---
## 20. Plan de implementación ordenado

Cada fase termina con un comando que tiene que salir bien antes de empezar la siguiente. Los marcadores se sustituyen **antes** de escribir el primer archivo (sección 1 y Anexo A); los que sigan pendientes se dejan como texto del marcador solo si el comando de la fase no los necesita.

### Fase 0 — Repositorio y herramientas

Copiar `.nvmrc`, `package.json`, `pnpm-workspace.yaml`, `infra/package.json`, los tsconfig, ESLint, Prettier, `.gitignore`, `.gitattributes`, `.env.example`.

```
corepack enable && corepack prepare pnpm@12.10.1 --activate
node -v    # v24.x, >= 24.11
pnpm install
pnpm typecheck   # falla hasta que exista src/, es esperable; el install no
```

### Fase 1 — Configuración y arranque vacío

Copiar `src/config/*`, `src/main.ts`, `src/configure-app.ts`, `src/app.module.ts` con los imports de módulos comentados, y un `health` provisional que no toque la base.

```
pnpm typecheck
pnpm lint
```

### Fase 2 — Base de datos local

PostgreSQL 17, las dos bases, `src/database/*`, entidades del núcleo (sin `Project` si el dominio no lo va a usar), `src/migrations/index.ts` y la migración inicial generada, más el trigger de `audit_logs` añadido a mano.

```
pnpm migration:run
pnpm db:seed
psql -d <app_snake> -c "\dt"
```

Tiene que verse `users`, `settings`, `user_terms_acceptances`, `audit_logs`, `documents` y `migrations`.

### Fase 3 — Auth

Sección 10 entera, guards de la sección 9, y la suite `test/auth*.e2e-spec.ts` con el arnés.

```
pnpm test:e2e
```

### Fase 4 — Un módulo de dominio

Partir de la sección 12. Sustituir `projects` por el primer recurso real. Migración nueva, registrada en `MIGRATIONS`. Suite e2e del recurso.

```
pnpm migration:generate src/migrations/Add<Recurso>
# leer el SQL antes de seguir
pnpm test:e2e:cov
```

### Fase 5 — Documentos

Sección 13. El procesador de dominio deja de ser el stub en el momento en que exista una regla de negocio que aplicar al archivo; mientras, el stub que marca `processed` es válido y la suite tiene que seguir pasando.

```
pnpm test:e2e
pnpm exec vitest run src/modules/documents/presign.spec.ts
```

### Fase 6 — Lambda

`lambda.ts`, `lambda-bootstrap.ts`, `lambda-migrator.ts`, `lambda-ingest.ts`, `scripts/bundle.mjs`, `scripts/lambda-smoke.mjs`.

```
pnpm build && pnpm bundle
node scripts/lambda-smoke.mjs
```

Tiene que verse el 200 de health, el 401 de `/api/auth/me` sin cookie y el 403 sin la cabecera de origen cuando `STAGE` es `dev`.

### Fase 7 — Infra y synth

`infra/` completo, con los marcadores ya sustituidos por los valores reales (o por los ficticios, si todavía no hay cuenta: entonces se usa `scripts/synth-check.sh` sin tocar las partes izquierdas de los `s///`).

```
bash scripts/synth-check.sh
# o, ya sustituido:
cd infra && pnpm cdk synth -c stage=dev --quiet
```

Cero hallazgos de cdk-nag fuera de `nag.ts`.

### Fase 8 — Pipeline

Workflows, `scripts/ci/*`, Environments de GitHub, despliegue del stack `ci` en la cuenta no-prod.

```
# desde una máquina con credenciales de la cuenta, una sola vez:
cd infra && pnpm cdk deploy -c ci=nonprod
```

El primer push a `main` despliega `dev`. Si no hay cuenta todavía, esta fase se detiene en "los YAML están copiados y `actionlint` pasa".

### Fase 9 — Frontera con el frontend

Publicar `openapi.json` (el job ya lo hace) y confirmar que las 21 rutas del núcleo siguen presentes antes de añadir las del dominio. El frontend se implementa contra ese archivo, no contra esta prosa.

---
## 21. Checklist de aceptación final

### Código

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm test:e2e:cov` pasan. La cobertura no baja de los umbrales de `vitest.e2e.config.mts`.
- [ ] `pnpm build && pnpm bundle` produce `.lambda/api`, `.lambda/migrator` y `.lambda/ingest-worker`.
- [ ] `node scripts/lambda-smoke.mjs` devuelve 200, 401 y 403 en los tres casos de la sección 8.3.
- [ ] No queda `synchronize: true`, ni `enableCors`, ni un token leído de `Authorization`, ni `runMigrations()` fuera del migrator.
- [ ] `rg -n "process\.env" src/modules` no devuelve nada.
- [ ] Toda entidad editable tiene `@VersionColumn()`. Todo importe es `numeric` / `string`.
- [ ] `MIGRATIONS` lista todas las clases de `src/migrations/`, en orden, y el trigger `audit_logs_immutable` sigue en la migración inicial.

### Contrato

- [ ] `openapi.json` se genera sin levantar la base y contiene `/api/health`, las rutas de `/api/auth/*`, `/api/users/{id}/status` y `/api/documents/*`.
- [ ] Ninguna operación declara seguridad `bearer`. La seguridad del documento es la cookie.

### Infra y pipeline

- [ ] `cdk synth` de dev, qa y prod termina con cdk-nag en silencio (solo las aceptaciones de `nag.ts`).
- [ ] `actionlint` sobre `.github/workflows/` y `shellcheck` sobre `scripts/**/*.sh` pasan.
- [ ] Los Environments `qa` y `prod` tienen revisores.
- [ ] El stack `ci` está desplegado en cada cuenta antes del primer stage.
- [ ] Un push a `main` despliega `dev`, migra **antes** de mover el alias, y el smoke contra CloudFront pasa.
- [ ] La URL de `dev` sirve el health en `https://<DOMINIO_APP>/api/health` y un `POST /api/auth/login` sin la cabecera de CloudFront (llamado directo al API) responde 403.

### Seguridad que se comprueba a mano una vez en dev

- [ ] Login con MFA: el primer acceso obliga a configurar TOTP y el segundo pide el código.
- [ ] La cookie de access tiene `HttpOnly`, `Secure`, `SameSite=Strict` y no tiene `Domain`.
- [ ] `POST /api/auth/refresh` sin la cookie de refresh responde 401 y no crea sesión.
- [ ] Un usuario desactivado recibe 403 con un access token todavía vigente.
- [ ] Con la base apagada, `/api/auth/me` responde 503, no 401.
- [ ] Un objeto que GuardDuty marca con amenaza queda `quarantined` y no se descarga.

---
## 22. Errores conocidos y cómo evitarlos

Los de la v1 que siguen siendo verdad, más los que aparecieron al verificar esta versión. Cada uno se encontró de verdad: o en el original, o en el proyecto de verificación del 07/10/2026.

### 22.1 `SECRET_HASH` en todo lo que no es el refresh

Sigue haciendo falta en `USER_PASSWORD_AUTH`, en los retos, en el signup y en el forgot-password, firmado con el username **interno** cuando la llamada es un reto (10.4). El refresh ya no entra en este grupo. Reintroducir `SECRET_HASH` en `GetTokensFromRefreshToken` hace que Cognito responda `InvalidParameterException`.

### 22.2 TLS

Local sin TLS, AWS con `rejectUnauthorized: true` y el bundle de Amazon (19.10). El error `self-signed certificate in certificate chain` en Lambda es, casi siempre, un `NODE_EXTRA_CA_CERTS` que no llegó al zip.

### 22.3 `express.raw()` solo en la ruta de contenido

Montarlo global convierte todos los body JSON en `Buffer` y class-validator responde 400 a toda la API (13.5).

### 22.4 El techo de 30 segundos

API Gateway HTTP API corta a los 30 s. Una operación más larga es un worker (SQS), no una ruta. El `statement_timeout` de 10 s existe para que la base falle antes que el gateway y el cliente reciba un 503 con `requestId`, no un 503 sin cuerpo de API Gateway.

### 22.5 El peso del bundle

El bundle de la API midió 6644 KB minificado (07/10/2026), muy por debajo del límite de 250 MB descomprimidos y del límite práctico de cold start. Si alguien añade un paquete que arrastra `aws-sdk` v2 entero, este número se dispara. El smoke imprime el tamaño: mirarlo en el PR.

### 22.6 `import.meta.url` dentro del bundle

Síntoma: `ERR_INVALID_ARG_VALUE` o un `require` que busca un paquete en el directorio desde el que se invocó la Lambda, no en el bundle. Causa: quitar el banner de `scripts/bundle.mjs` (6.11). NestJS 12 llama a `createRequire(import.meta.url)`.

### 22.7 `keepNames`

Síntoma: `Nest can't resolve dependencies of UsersService (?)` solo dentro de Lambda; en local funciona. Causa: minificar sin `keepNames`. El token de inyección dejó de coincidir con el nombre de la clase.

### 22.8 `pino-pretty` en Lambda

Síntoma: la primera petición revienta con `MODULE_NOT_FOUND` de `pino-pretty/lib/worker.js`. Causa: `pretty: true` cuando `AWS_LAMBDA_FUNCTION_NAME` está definido. El worker thread no existe dentro del bundle. `app.module.ts` ya lo evita; no lo "actives en prod para leer mejor los logs". En prod se leen JSON.

### 22.9 pnpm 12 y los scripts de instalación

Síntoma: `ERR_PNPM_IGNORED_BUILDS` al instalar, citando `esbuild` o `@swc/core`. Causa: falta la entrada en `allowBuilds` de `pnpm-workspace.yaml`. No se resuelve con `pnpm config set ignore-scripts false` en la máquina de un desarrollador: CI volvería a fallar.

### 22.10 Checksum CRC32 en la URL prefirmada

Síntoma: el navegador recibe 403 de S3 y la URL contiene `x-amz-checksum-crc32`. Causa: el cliente S3 sin `requestChecksumCalculation: 'WHEN_REQUIRED'`, o la firma sin `signableHeaders` / `unhoistableHeaders` (7.5, 13.3).

### 22.11 `save()` cuando el id lo pone el llamador

Síntoma: un signup que debía fallar por email duplicado devuelve 201 y ha pisado la fila del otro usuario. Causa: `repository.save()` con la clave primaria presente hace `UPDATE`. Para `users` se usa `insert()` (10.6).

### 22.12 `dropDatabase()` en los tests

Deja funciones y triggers. El segundo `runMigrations` falla con "trigger already exists". El arnés hace `DROP SCHEMA public CASCADE` (15.2).

### 22.13 `numeric` llega como string

`amount: "10.50"`, no `10.5`. Un DTO con `@IsNumber()` rechaza el valor que la propia API acaba de devolver. Los DTOs de importes usan `@IsString()` y `decimal.js` valida el formato.

### 22.14 El `ENUM` de PostgreSQL

Añadir un valor con `ALTER TYPE ... ADD VALUE` no se puede correr dentro de la transacción que TypeORM abre para la migración, y el despliegue se queda a medias. `varchar` + `@Check` (11.1).

### 22.15 CRLF

`set -euo pipefail` con un `\r` al final es un error de bash ilegible (`$'
': command not found`). `.gitattributes` con `eol=lf` (6.4).

### 22.16 Claves de S3 con caracteres codificados

EventBridge entrega `incoming/a%20b.pdf`. Sin `decodeURIComponent` el worker no encuentra la fila (13.4).

### 22.17 Carrera en la deduplicación por hash

Comprobar con `SELECT` y luego `INSERT` permite dos filas. El índice único parcial es el que gana (13.1). El servicio captura `23505` y responde 409.

### 22.18 `dist/` viejo

`migration:run` y el bundle leen `dist/`. Si se cambia una entidad y se corre el CLI sin `pnpm build`, se aplica el esquema anterior. Los scripts de `package.json` ya llevan el `pnpm build` delante. No invocar `typeorm` a mano contra un `dist/` de ayer.

### 22.19 TypeScript 6 y `moduleResolution: node16`

`TS5110`: si se fija `moduleResolution` en `node16`, `module` tiene que ser `Node16` o superior, y el emit deja de ser el CommonJS que el bundle espera. No declarar `moduleResolution` (6.1).

### 22.20 cdk-nag 3 no es un Aspect

`Aspects.of(app).add(new AwsSolutionsChecks())` falla con `visit is not a function`. El registro correcto es `Validations.of(app).addPlugins(new AwsSolutionsChecks(app))` (16.10).

### 22.21 `@UseGuards` repetido

Con los guards globales, volver a colgar `JwtAuthGuard` en un método no aporta y, si se cuelga solo ese y no el de roles, da la impresión de que la autorización está resuelta en el método. No se repite. `@Roles` y `@Public` son la superficie.

### 22.22 CORS

No hay. Añadir `enableCors({ origin: true })` para depurar un frontend que llama al puerto 3000 directo es el síntoma de que el proxy de Nuxt no está configurado. Se arregla el proxy, no se abre CORS (8.1).

### 22.23 Cold start envenenado

Cachear una promesa de bootstrap que ya rechazó deja la Lambda en 503 hasta que AWS la mate. `lambda.ts` y el migrator descartan la promesa si falla (8.3). El mismo patrón va en cualquier handler nuevo (14.1).

### 22.24 Rotación del secreto del maestro

Leer el secreto una vez y guardarlo en una variable de módulo hace que, el día 30, el migrator empiece a fallar con `password authentication failed` y no se recupere solo. Se lee en cada invocación (11.6).

---
## 23. Seguridad empresarial

🆕 **V2.** Esta sección es el mapa. El código está en las secciones que cita. Sirve para revisar un PR que "solo añade un endpoint" y comprobar que no abre un agujero que el núcleo ya había cerrado.

### 23.1 Identidad

- Cognito es el único sitio que ve contraseñas. Mínimo 12 caracteres, cuatro clases, historial de 5, y el DTO repite la misma regla para fallar antes de llamar al pool (10.5).
- MFA TOTP obligatorio en el primer login (`mfa: 'REQUIRED'`).
- El access token dura 15 minutos y el refresh rota en cada uso, con 10 segundos de gracia para pestañas duplicadas (10.4, 16.5).
- Cerrar sesión revoca el refresh en Cognito (`RevokeToken`). Cerrar todas las sesiones usa `GlobalSignOut`. Borrar la cookie sin revocar deja un refresh válido hasta los 30 días.
- Un usuario `disabled` queda fuera en el siguiente request, aunque el access token no haya caducado (9.1).

### 23.2 Sesión y navegador

- Cookies `httpOnly` + `Secure` + `SameSite=Strict` + prefijo `__Host-` en el access token (10.1). JavaScript no las lee, un subdominio no las planta, un sitio de terceros no las envía.
- CSRF: además de SameSite, el middleware exige `Sec-Fetch-Site: same-origin` u `Origin` igual a `APP_ORIGIN` en los métodos que cambian estado (9.2).
- Un solo origen. No hay CORS. El día que alguien proponga servir el front en otro dominio, la conversación correcta es por qué, no cómo relajar la CSP.
- Helmet en la API con `default-src 'none'` y `frame-ancestors 'none'`. HSTS y el resto de cabeceras de documento los pone CloudFront sobre el HTML (16.8).

### 23.3 Borde

- WAF con reglas gestionadas y dos límites de tasa: 100 / 5 min en `/api/auth/` y 3000 / 5 min global (16.8). El límite de login es por IP. No hay un `@nestjs/throttler`: en Lambda cada contenedor tiene su propia memoria y el contador no se comparte, así que un throttler en proceso deja pasar N veces el límite.
- La API rechaza cualquier petición sin `x-origin-verify` en los stages desplegados. Llamar al execute-api de API Gateway desde internet devuelve 403.
- Throttling de cuenta en el stage del HTTP API, por debajo del límite de WAF, para que un pico se corte con 429 de API Gateway antes de abrir Lambdas.
- Security groups: RDS solo acepta al proxy y al migrator. Las Lambdas salen por NAT. S3 se va por el endpoint gateway, sin salir a internet.

### 23.4 Datos y secretos

- `app_user` no tiene contraseña (11.3). El maestro rota cada 30 días y solo lo lee el migrator.
- Los secretos no son variables de entorno. Son ARNs, y el valor se lee al arrancar (7.4). No se imprimen: pino los redacta y el error de Secrets Manager cita el ARN, no el valor (9.3).
- `audit_logs` no se puede actualizar ni borrar, ni siquiera con el rol maestro, por el trigger (11.4).
- Documentos cifrados con KMS del stage, prefijo `incoming/` escaneado por GuardDuty antes de que el procesador de dominio los vea (13.4).
- El zip de la Lambda no contiene `.env`. `ignoreEnvFile` está forzado cuando existe `AWS_LAMBDA_FUNCTION_NAME`.

### 23.5 Suministro y dependencias

- OIDC. No hay `AWS_ACCESS_KEY_ID` en GitHub (16.9, 17.3).
- `pnpm audit --prod --audit-level high` es un paso que falla el PR.
- Dependabot semanal y CodeQL `security-extended` (17.1).
- Los scripts de postinstall están en lista blanca (17.1). Un paquete nuevo que necesite compilar se ve en el diff de `pnpm-workspace.yaml`.
- cdk-nag es gate de synth, no un informe que alguien lee si se acuerda (16.10).

### 23.6 Lo que esta versión deja apagado a propósito

| Control | Estado | Cómo se enciende |
|---|---|---|
| Cognito Plus (credenciales filtradas, riesgo adaptativo) | Apagado (`ESSENTIALS`) | `featurePlan: 'PLUS'` en el stage que corresponda |
| Restricción geográfica | Apagada | `geoAllowList: ['PE', …]` |
| Correo con dominio propio (SES) | Apagado: email por defecto de Cognito | Anexo A, cuando haya dominio de correo verificado |
| WAF Bot Control / ATP | No incluido | Es un add-on de pago por millón de peticiones; se añade como regla gestionada el día que el tráfico lo justifique |

Ninguno de esos apagados impide pasar una revisión de arquitectura. Están escritos como un cambio de config, no como un proyecto nuevo.

---
## 24. Observabilidad

🆕 **V2.**

### 24.1 Logs

Una línea JSON por petición, emitida por pino, con `requestId`, método, ruta, status y latencia. Sin cookies, sin secretos, sin body (9.3). El `requestId` de la línea es el mismo que el cliente recibe en `x-request-id` y en el cuerpo de error, y el mismo que se guarda en `audit_logs`.

Para seguir una petición: el id que muestra la UI (el frontend lo enseña cuando hay un error) se pega en Logs Insights.

```
fields @timestamp, msg, req.url, res.statusCode
| filter requestId = "…"
```

`/api/health` no se loguea en el access log de la aplicación. Sí aparece en los access logs de API Gateway, que es donde se mira si el balanceador está pegando.

### 24.2 Trazas

X-Ray activo en la Lambda y en el HTTP API. No se enciende el tracing de Sentry a la vez (9.3): dos exportadores de OpenTelemetry en el mismo proceso se pisan y el cold start crece. Sentry recibe errores 5xx, con `release` igual al SHA del despliegue, y hace `flush` antes de volver.

### 24.3 Alarmas

Todas publican en el topic `<app-short>-<stage>-alerts`, y de ahí al correo `<ALERT_EMAIL>`.

| Alarma | Qué indica |
|---|---|
| 5xx de la API | El canary de prod se revierte solo si esta dispara durante el despliegue |
| p95 de latencia de la API | Por encima del umbral del stack, no es un apagón pero es una degradación |
| Throttles de la Lambda | El límite de concurrencia o el de la cuenta se quedó corto |
| Mensajes en la DLQ de ingesta | Un documento lleva tres intentos fallando. No se reintenta solo otra vez |
| CPU y almacenamiento libre de RDS | Capacidad, con días de margen en el almacenamiento gracias al autoscaling |
| Presupuesto al 80 % y al 100 % | Coste, no salud. Evita descubrir la factura a fin de mes |

El dashboard del stack de API junta peticiones, errores, latencia y conexiones del proxy. Es la primera pantalla de una incidencia, no un sustituto de las alarmas.

### 24.4 Lo que se correlaciona

`release` (SHA) va en el health y en Sentry. Cuando una alarma salta, se sabe qué commit está detrás del alias `live` sin entrar a la consola de Lambda. El pipeline no promueve un SHA distinto del que pasó `verify`: el artefacto `release-<sha>` es el mismo zip.

---
## 25. Rendimiento

🆕 **V2.** Los números de esta sección son del proyecto de verificación (07/10/2026, Node 24, bundle real, PostgreSQL 17 local), no estimaciones.

### 25.1 Arranque

| Medida | Valor |
|---|---|
| Carga del módulo del bundle | 164 ms |
| Primera invocación (bootstrap de Nest + primera query) | 411 ms |
| Segunda invocación en el mismo proceso | 2.1 ms |
| Tamaño del bundle de la API, minificado | 6644 KB |
| Migrator / ingest-worker | 2351 KB / 2416 KB |

El cold start que ve un usuario en prod no es el de la tabla: la concurrencia provisionada del alias `live` (2 en prod) mantiene entornos calientes. Dev y qa no la pagan; el primer request después de un rato de silencio paga ~400 ms más el tiempo de VPC. Es aceptable en esos stages y está escrito en `config.ts` para subirlo sin tocar código.

1769 MB en prod no es un capricho de "más memoria = más rápido" suelto: Lambda asigna CPU en proporción a la memoria, y el bootstrap de Nest es CPU. 1769 MB es el escalón en el que la función recibe una vCPU entera. Por debajo, el cold start crece más de lo que se ahorra.

### 25.2 Camino de una petición

El navegador habla con CloudFront (HTTP/2 y HTTP/3) en el mismo origen. `/api/*` no pasa por el bucket. No hay preflight de CORS: una petición same-origin simple es un solo round trip.

La Lambda no abre conexiones nuevas a Postgres en cada request. El pool es de 3, delante de RDS Proxy, que multiplexa hacia la instancia. El token IAM se regenera cuando el driver pide una contraseña, no una vez por arranque (7.2).

`statement_timeout` de 10 s y el throttling del API acotan el daño de una query mala o de un cliente que reintenta en bucle.

### 25.3 Lo que no se mete en el camino crítico

- El antivirus y el parseo de documentos ocurren en la cola, no en el `POST` que devuelve la URL. El usuario recibe la URL en una query y un `INSERT`.
- Swagger no se registra en Lambda (`main.ts` solo lo monta en el proceso local).
- `pino-pretty` no existe en el bundle.
- Las migraciones no ocurren en el request.

### 25.4 Presupuesto

Dev está dimensionado para ser el sitio donde se prueba, no un clon de prod: `t4g.micro`, una NAT, sin provisioned concurrency, logs a 30 días. El presupuesto de la config (150 USD dev, 200 qa, 1500 prod) alerta antes de que un experimento se deje encendido. Los números son techos de aviso, no una previsión de factura: se ajustan cuando exista un mes real de uso.

---
## 26. Datos, backups, recuperación y cumplimiento

🆕 **V2.**

### 26.1 Copias

| Qué | Retención | Dónde se configura |
|---|---|---|
| Backups automáticos de RDS, dev y qa | 7 días | `db.backupRetentionDays` |
| Backups automáticos de RDS, prod | 35 días | igual |
| Point-in-time recovery | Dentro de esa ventana | lo enciende el mismo backup |
| Multi-AZ | Solo prod | `db.multiAz` |
| Versionado del bucket de documentos | Activo | `storage-stack` |
| Logs de aplicación | 30 días (dev/qa), 13 meses (prod) | `logRetentionDays` |

Un punto de restauración es un clon, no un `DROP` de la instancia que está sirviendo. El procedimiento, cuando haga falta, es: restaurar a una instancia nueva desde el PITR, apuntar un stage de qa al clon (cambiando el secreto del maestro de qa, no el de prod) y comprobar el health antes de decidir si se promueve. No hay un botón de "recuperar prod" en el pipeline, a propósito: es una decisión de incidente, no un job.

`deletionProtection` está activo en prod. Borrar el stack de prod en un `cdk destroy` distraído falla, y eso es lo que se quiere.

### 26.2 Despliegue y marcha atrás

El esquema se migra antes que el código, y la migración es compatible con el código que todavía sirve (11.4). Si el código nuevo está mal, el canary de prod lo detecta por la alarma de 5xx y CodeDeploy devuelve el alias al version anterior sin tocar el esquema. Por eso una migración no puede quitar una columna que el código viejo todavía lee.

Si hay que deshacer una migración, es la acción `revert` del migrator con `confirm: "REVERT_ONE"`, una sola, invocada a mano, no por el pipeline. Revierte la última. No hay un "revert all".

### 26.3 Residencia y borrado

La región es `<REGION>` para datos, cómputo y backups. El único recurso fuera de esa región es el par certificado + WAF en `us-east-1`, que no almacena datos de negocio: CloudFront no es un almacén, y el WAF ve metadatos de la petición.

No hay borrado físico de usuarios ni de auditoría. Desactivar es el mecanismo. Los documentos en cuarentena se quedan: son la evidencia de por qué no se procesaron. El lifecycle del bucket solo expira subidas a `incoming/` que nadie confirmó.

### 26.4 Datos personales

El email, el nombre y el sub viven en `users` y, como `sub`, en `audit_logs` y en `uploaded_by_sub`. Los logs de aplicación no llevan email: el filtro y la redacción de pino están para eso (9.3). Un export de "todo lo que tenemos de esta persona" es una consulta por `sub` a esas tres tablas; no está implementada como endpoint porque el dominio todavía no ha dicho quién puede pedirla (Anexo A). Cuando se añada, es un `GET` de `<ROL_B>` que lee esas tablas y nada más.

### 26.5 Lo que no cubre este núcleo

- Un segundo región activa (activo-activo). El coste y la complejidad no se justifican hasta tener un objetivo de RTO escrito por negocio. Multi-AZ cubre la caída de una zona, que es el fallo que realmente ocurre.
- Cifrado a nivel de columna. El disco de RDS y el bucket ya están cifrados. Cifrar columnas sueltas se añade el día que un dato concreto lo exija, no por adelantado: TypeORM y las búsquedas se complican y es fácil dejar de poder consultar.
- Copias fuera de la cuenta (backup cross-account). Es el siguiente paso razonable de prod y requiere la cuenta de prod, que todavía es un marcador. Se hace con una copia del snapshot a `<ACCOUNT_PROD>` de seguridad, no reescribiendo el stack.

---
## 27. Registro de decisiones (ADR)

🆕 **V2.** Cada decisión de abajo se tomó al escribir esta versión, con el dato que la sostiene. Cambiarla es un PR que actualiza esta sección, no un parche silencioso en un archivo.

### ADR-1. Node 24 en Lambda, local y CI

Node 20 en Lambda se deprecó el 30/04/2026. `nodejs22.x` se depreca el 30/04/2027. `nodejs24.x` está soportado hasta el 30/04/2028. Un proyecto que arranca ahora y eligiera 22 tendría que migrar de runtime dentro de su primer año. Node 24 no admite handlers de callback: el export de `lambda.ts` es async y el adaptador es `@codegenie/serverless-express` 5, que devuelve promesas.

### ADR-2. TypeScript 6.0, no 7

Nest CLI 12 fija TypeScript `~6.0`. `typescript-eslint` 8 no acepta TypeScript 7. Aunque el compilador 7 ya emite metadata de decoradores, el resto de la cadena no arranca. Se queda en `~6.0.3`, que es lo que se compiló y se testeó.

### ADR-3. pnpm 12 y Vitest 5

Un solo gestor en los dos repositorios, con `packageManager` fijado, para que el lockfile sea reproducible y los scripts de instalación queden en lista blanca. Vitest, y no Jest, porque la suite corre sobre SWC (que sí emite metadata de decoradores) y el arranque es el que se midió en CI. La cobertura se exige en el job e2e, no en el unitario.

### ADR-4. AWS CDK, no Serverless Framework

Serverless Framework v3 está sin mantenimiento desde 2025 y v4 exige licencia. La alternativa mantenida (`osls`) seguiría siendo un framework cuyo trabajo real (la VPC, el proxy, el WAF, las alarmas, OIDC) ya no cabe en un `serverless.yml` corto. CDK describe todo el sistema, y cdk-nag lo revisa en el synth. El coste es aprender los constructs; el código de `infra/lib/` es ese aprendizaje ya escrito.

### ADR-5. Un origen, cookies `httpOnly`

El frontend y la API se sirven bajo `<DOMINIO_APP>`. CloudFront parte `/api/*` hacia API Gateway e inyecta `x-origin-verify`. El backend emite la sesión en cookies que JavaScript no lee. Se descartó guardar tokens en memoria del SPA: un refresco de página obliga a un baile de tokens en el body, y cualquier librería de logs del navegador se los queda. Se descartó el header `Authorization`: obliga a que el JS lea el token, que es justo lo que no queremos.

### ADR-6. IAM de extremo a extremo contra RDS Proxy

La Lambda de la API no tiene una contraseña que rotar, filtrar o copiar a un `.env`. El token dura 15 minutos y el driver lo pide como función. El usuario maestro existe porque las migraciones necesitan DDL y el proxy con IAM no lo da; está encerrado en el migrator y rota solo.

### ADR-7. Migrar antes de publicar

El pipeline aplica el esquema y después mueve el alias. Combinado con migraciones compatibles hacia atrás, un fallo del código nuevo se revierte con CodeDeploy sin una migración de emergencia a las 3 de la mañana. El canary es del 10 % durante 5 minutos y solo en prod, donde hay tráfico para que la alarma signifique algo.

### ADR-8. Prod en otra cuenta

`dev` y `qa` comparten `<ACCOUNT_NONPROD>`. `prod` está en `<ACCOUNT_PROD>`. Un rol de deploy de dev no puede tocar prod porque es otra cuenta, no porque una policy esté bien escrita. El stack `ci` se despliega una vez en cada una. No se automatiza AWS Organizations: con dos cuentas, un stack por cuenta es más simple y se entiende en un PR.

### ADR-9. TypeORM 1.1 fijado sin rango

`migration:generate` cambia el SQL que emite entre versiones menores. El paquete va fijado en `1.1.1`. Subirlo es un PR que regenera una migración de prueba y enseña el diff. Las roturas de la 1.0 que el código ya respeta: `select` y `relations` solo en forma de objeto, `null` dentro de `where` lanza, no existe `findOneById` ni `Connection`.

### ADR-10. Falla cerrado, pero un corte de base no es un logout

Si no se puede leer la fila del usuario, no se le autoriza. El status de ese caso es 503, no 401. Un 401 haría que el frontend tirara la sesión y mandara a todo el mundo al login durante un blip de RDS. El 503 se reintenta.

### ADR-11. Español fijo en los mensajes de la API

Los mensajes de error y de validación están en español, que es el idioma de quienes operan la aplicación. No hay capa de i18n en el núcleo. Añadirla el día que exista un segundo idioma es un mapa de mensajes, no una reescritura: los mensajes ya viven en los DTOs y en las excepciones, no repartidos por las plantillas.

### ADR-12. Sin multi-tenant en el esquema

No hay `tenant_id` en las tablas. El producto, hoy, es una organización por despliegue (una cuenta, un stage, un pool). Meter la columna "por si acaso" obliga a no olvidarla en cada query y a testear el aislamiento desde el primer día, para un requisito que nadie ha pedido. Si aparece, es una migración de expandir (columna nullable, luego obligatoria) y un filtro en el guard, no un rediseño de la infraestructura.

---
## Anexo A — Puntos abiertos y cómo resolverlos

El núcleo se puede implementar y desplegar en `dev` sin estos datos, usando los valores propuestos de la sección 1 donde los hay. Lo que sigue **bloquea un despliegue de prod con usuarios reales**, y son decisiones de producto, no de código. Cada una tiene las opciones y el sitio exacto del cambio.

### A.1 Dominio

| Opción | Efecto |
|---|---|
| Un dominio propio (`app.ejemplo.com`, `app-dev.ejemplo.com`, `app-qa.ejemplo.com`) | Se rellena `<DOMINIO_BASE>`, `<HOSTED_ZONE_ID>` y la zona ya existe en Route 53 de la cuenta. Es el camino que el stack espera |
| Sin dominio todavía | `dev` puede salir con el dominio por defecto de CloudFront, pero las cookies `Secure` y el certificado hay que resolverlos antes de que un navegador guarde la sesión. No es un modo que el stack implemente: se espera a la zona |

### A.2 Cuentas AWS

| Opción | Efecto |
|---|---|
| Dos cuentas, como está escrito | `<ACCOUNT_NONPROD>` y `<ACCOUNT_PROD>`. Recomendado (ADR-8) |
| Una sola cuenta para los tres stages | Posible: los nombres llevan el stage y no chocan. Se pierde el aislamiento de prod. Hay que cambiar el `account` de `prod` en `config.ts` y el trust de OIDC |

### A.3 Nombre del rol operativo (`<ROL_A>`)

`<ROL_B>` queda en `Admin`. `<ROL_A>` es el grupo de quien usa la aplicación sin administrar usuarios. Hasta que el dominio tenga nombre (Operaciones, Analista, …), los `@Roles` del código de ejemplo no compilan sustituidos. No afecta al núcleo de auth, que trata el nombre como un marcador.

### A.4 Alta de usuarios

| Opción | Dónde |
|---|---|
| Cada persona se registra (`selfSignup: true`) | Ya está así en `config.ts` y en `AUTH_SELF_SIGNUP` |
| Solo invitación | `selfSignup: false` y las altas salen de `create-admin` o de un endpoint de `<ROL_B>` que llame a `AdminCreateUser` |

### A.5 Correo

| Opción | Efecto |
|---|---|
| Dejar el email por defecto de Cognito | Funciona el primer día. Remitente genérico, cuota baja, los correos caen en spam |
| SES con un subdominio (`no-reply@<DOMINIO_BASE>`) | Hay que verificar la identidad en la misma región y añadirla al user pool. No está escrito en `auth-stack.ts` porque sin el dominio no se puede sintetizar |

### A.6 Cognito Plus

| Opción | Efecto |
|---|---|
| Essentials (actual) | MFA, rotación de refresh, precio menor |
| Plus | Añade protección contra credenciales comprometidas y riesgo adaptativo. Se cambia `featurePlan` a `'PLUS'` y se quita la aceptación `COG8` de `nag.ts` |

### A.7 Países

`geoAllowList` vacío deja el WAF sin filtro geográfico (aceptación `CFR1`). Cuando se sepa desde qué países se opera, se rellena el array y el synth deja de aceptar `CFR1`.

### A.8 El resto de marcadores pendientes

| Marcador | Quién lo da | Dónde se usa |
|---|---|---|
| `<ALERT_EMAIL>` | Operaciones | Suscripción del topic de alarmas |
| `<SENTRY_DSN_BACKEND>` | Quien cree el proyecto de Sentry | Variable de la Lambda. Vacío = Sentry no se inicializa, y todo lo demás funciona |
| `<ENTITY_ID>` | El dominio | Columna `entityId` de documentos: el identificador natural del dueño del archivo |
| `<DOC_TIPO_1..3>` | El dominio | El DTO de documentos rechaza cualquier tipo que no esté en la lista |
| `<TERMS_URL>` | Legal | `GET /api/auth/terms-link` lo devuelve para que el signup lo muestre |

### A.9 Lo que se verificó y lo que no

Verificado el 07/10/2026, sin cuenta AWS: compilación, lint con tipos, 10 unitarios, 44 e2e contra PostgreSQL 17, bundle con invocación simulada de API Gateway (200/401/403), `cdk synth` de los cinco conjuntos con cdk-nag limpio, `actionlint` y `shellcheck`.

No verificado, porque hace falta la cuenta: el primer `cdk deploy`, el correo de Cognito llegando a una bandeja real, GuardDuty etiquetando un objeto, el canary ante un 5xx provocado, y la alarma llegando a `<ALERT_EMAIL>`. El plan de la fase 8 y el checklist de la sección 21 son esa verificación. No se marca como hecha desde aquí.

---
