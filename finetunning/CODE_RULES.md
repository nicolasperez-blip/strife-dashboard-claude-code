# Reglas del proyecto

## Reglas de codigo
- Las aplicaciones Web deben seguir las pautas de Resumen de los estándares de accesibilidad de W3C, al menos clase A

## CSS
- NUNCA estilar elementos HTML directamente (`div { }`, `button { }`, `h1 { }`). Todo estilo va en clases.
- Usar herencia y composición de clases; reutilizar clases existentes antes de crear nuevas.
- Si es posible, usar Tailwind CSS en lugar de CSS propio.
- Evitar estilos inline (`style={{ }}`) salvo para valores dinámicos que no se puedan expresar con clases.
- Intentar usar animationes o transitions para los :hovers, la experiencia debe ser "smooth" y siguiendo tambien las normas de accessibilidad por si el usuario desactiva las animaciones

## React
- Siempre usar TypeScript.
- Cada componente va en su propio archivo, y el nombre del archivo coincide con el del componente (`Button.tsx` exporta `Button`).
- Las props de cada componente SIEMPRE se tipan con una interface exportada llamada `<NombreDelComponente>Props` (ej. `ButtonProps` para `Button`).
- Los componentes se declaran como arrow function con `React.FC`, usando named export:

  ```tsx
  export interface ButtonProps {
    label: string;
    onClick: () => void;
  }

  export const Button: React.FC<ButtonProps> = (props) => {
    return <button className="btn">{props.label}</button>;
  };
  ```

- Las llamadas a la API van en un service, y los componentes llaman al service directamente (nunca `fetch`/`axios` inline en el componente).

### Estructura de carpetas
- `components/`: componentes stateful, organizados en subcarpetas por vista (`components/Dashboard/`, `components/Settings/`). Ocasionalmente puede haber componentes stateless.
- `library/`: componentes presentacionales y reutilizables (botones, acordeones, modales, etc.).
- Todo componente custom nuevo se crea en `library/` y se consume desde afuera (importado desde `components/`), no se define dentro del componente que lo usa.

## JS / TypeScript
- Evitar one-liners con control de flujo. Mal: `if (!cwd) return setErr('Elegí un proyecto.');`. Bien:

  ```ts
  if (!cwd) {
    setErr('Elegí un proyecto.');

    return;
  }
  ```

- Separar con líneas en blanco los bloques de código relacionados entre sí.
- Usar siempre named exports en lugar de default exports (`export const UserCard`, no `export default UserCard`).
