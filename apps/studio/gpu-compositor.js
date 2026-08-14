export async function createCompositor(canvas) {
  if (globalThis.navigator?.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      const device = await adapter?.requestDevice();
      const context = canvas.getContext("webgpu");
      if (device && context) {
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: "premultiplied" });
        return {
          backend: "webgpu",
          clear([r = 0, g = 0, b = 0, a = 1] = []) {
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginRenderPass({
              colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: { r, g, b, a }, loadOp: "clear", storeOp: "store" }],
            });
            pass.end();
            device.queue.submit([encoder.finish()]);
          },
          device,
        };
      }
    } catch {}
  }
  const context = canvas.getContext("2d");
  return {
    backend: "canvas2d",
    clear([r = 0, g = 0, b = 0, a = 1] = []) { context.clearRect(0, 0, canvas.width, canvas.height); context.fillStyle = `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`; context.fillRect(0, 0, canvas.width, canvas.height); },
    context,
  };
}
