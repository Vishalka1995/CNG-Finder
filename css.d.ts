// Lets TypeScript accept `import "@/global.css"` in the root layout.
// NativeWind consumes the file through Metro; TS just needs to know it exists.
declare module "*.css";
