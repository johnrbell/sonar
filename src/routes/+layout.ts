// Client-only rendering: the app is a heavily interactive d3 canvas that reads
// window/localStorage on mount, so there's nothing useful to server-render.
export const ssr = false;
