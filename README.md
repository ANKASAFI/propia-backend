# PROPIA API

API local de PROPIA. PostgreSQL en `127.0.0.1:5432`, base `propia`, usuario `propia`, clave `propia_local_dev`.

```bash
pnpm install
pnpm dev
```

La API queda en `http://localhost:3000`. Al primer arranque crea las tablas y carga los datos de ejemplo.

Cuentas de prueba, todas con la contraseña `Propia.2026`:

- `joel.villanueva@email.com` — inversionista habilitado
- `camila.rios@email.com` — habilitación, falta la firma del cónyuge
- `lucia.ramos@propia.pe` — tesorería
- `diego.salas@propia.pe` — operaciones
- `marcos.quispe@propia.pe` — cumplimiento
- `elena.vargas@propia.pe` — admin

La firma de DocuSign, en local, se confirma dentro de la app. No hace falta AWS ni un correo real: el código de verificación vuelve en la respuesta (`devCode`).
