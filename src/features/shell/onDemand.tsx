import { useEffect, useState, type ComponentType } from "react";

/**
 * A component whose code loads the first time it renders (or on preload()):
 * it renders nothing until then, and synchronously once loaded. Used instead
 * of React.lazy + Suspense, whose first reveal React holds back for up to
 * 300 ms after the fallback shows (a dialog would open late).
 */
export function onDemand<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;

  const preload = () =>
    (pending ??= load().then(
      (component) => (loaded = component),
      (err: unknown) => {
        pending = null; // let the next render try again
        throw err;
      },
    ));

  function OnDemand(props: P) {
    const [Component, setComponent] = useState(() => loaded);
    useEffect(() => {
      if (Component) return;
      let live = true;
      preload().then(
        (component) => live && setComponent(() => component),
        (err: unknown) => console.error(err),
      );
      return () => {
        live = false;
      };
    }, [Component]);
    return Component ? <Component {...props} /> : null;
  }

  return Object.assign(OnDemand, { preload });
}
