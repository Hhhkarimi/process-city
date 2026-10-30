import { defineConfig } from "vite";
export default defineConfig({
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "city-graphics",
              test: /node_modules[\\/]three[\\/]/,
              maxSize: 350000,
            },
          ],
        },
      },
    },
  },
  server: {
    proxy: { "/api": { target: "http://127.0.0.1:4317", changeOrigin: true } },
  },
});
