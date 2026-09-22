import React, { useEffect, useRef } from 'react';

const HexLatticeCanvas = ({ animated = true }) => {
    const canvasRef = useRef(null);
    const animRef = useRef(null);
    const timeRef = useRef(0); // persist time across re-renders

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { alpha: false });
        // Lock to standard 1x scale to prevent major performance drops on Retina displays
        const dpr = 1;

        const renderScale = 0.5; // Crucial for dropping 50% CPU math scaling limits

        // Mathematical hexagon sizing constants (flat-top)
        const hexRadius = 55; // Increased to 55 to halve the number of grid items drawn per frame
        const hexW = Math.sqrt(3) * hexRadius;
        const hexH = hexRadius * 2;
        const horizSpacing = hexW;
        const vertSpacing = hexH * 0.75;

        let W = 0;
        let H = 0;
        let cols = 0;
        let rows = 0;

        // Pre-compute Path2D definitions to massively eliminate per-frame Math overhead
        const hexPath = new Path2D();
        const innerHexPath = new Path2D();
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i - Math.PI / 6;

            const px1 = (hexRadius - 1) * Math.cos(angle);
            const py1 = (hexRadius - 1) * Math.sin(angle);
            i === 0 ? hexPath.moveTo(px1, py1) : hexPath.lineTo(px1, py1);

            const px2 = (hexRadius - 3) * Math.cos(angle);
            const py2 = (hexRadius - 3) * Math.sin(angle);
            i === 0 ? innerHexPath.moveTo(px2, py2) : innerHexPath.lineTo(px2, py2);
        }
        hexPath.closePath();
        innerHexPath.closePath();

        const drawFrame = () => {
            if (W === 0 || H === 0) return;

            const time = timeRef.current;

            // 1. BASE LAYER: Dark background
            ctx.fillStyle = '#050a08';
            ctx.fillRect(0, 0, W, H);

            // 2. GLOW LAYER: Sweeping diagonal radial gradients behind the glassy net
            const glowX = W * 0.5 + Math.cos(time * 0.6) * W * 0.3;
            const glowY = H * 0.5 + Math.sin(time * 0.4) * H * 0.3;
            const bgGlow = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, Math.max(W, H) * 0.65);
            bgGlow.addColorStop(0, 'rgba(160, 210, 40, 0.18)'); // Bright yellow-green core
            bgGlow.addColorStop(0.5, 'rgba(0, 150, 120, 0.08)'); // Teal mid
            bgGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = bgGlow;
            ctx.fillRect(0, 0, W, H);

            // 3. HONEYCOMB NET with Illuminating Diagonal Groups
            ctx.lineWidth = 1.5;

            // Pan offsets for slow constant base grid drift (optional, adds to realism)
            const offsetX = time * 8;
            const offsetY = time * 6;

            // Calculate moving logical start coordinates to avoid visual modulo snapping
            const startCol = Math.floor(offsetX / horizSpacing) - 2;
            const startRow = Math.floor(offsetY / vertSpacing) - 2;

            for (let row = startRow; row < startRow + rows + 4; row++) {
                for (let col = startCol; col < startCol + cols + 4; col++) {
                    const x = col * horizSpacing + (Math.abs(row % 2) === 1 ? horizSpacing * 0.5 : 0) - offsetX;
                    const y = row * vertSpacing - offsetY;

                    const diag = col * 0.12 + row * 0.12 - time * 8.5;
                    const orth = col * 0.3 - row * 0.3 + time * 2;
                    const blobNoise = Math.sin(diag) + (Math.cos(orth) * 0.25);

                    ctx.translate(x, y);

                    let fillStyle = 'rgba(0, 6, 6, 0.4)';
                    let strokeStyle = 'rgba(20, 60, 50, 0.6)';
                    let innerHighlight = 'rgba(255, 255, 255, 0.03)';
                    let isGlowing = false;

                    if (blobNoise > 0.95) {
                        const intensity = Math.min((blobNoise - 0.95) / 0.3, 1);
                        fillStyle = `rgba(245, 210, 40, ${0.15 + intensity * 0.55})`;
                        strokeStyle = `rgba(255, 230, 80, ${0.4 + intensity * 0.5})`;
                        innerHighlight = `rgba(255, 255, 255, ${0.05 + intensity * 0.45})`;
                        isGlowing = true;

                        if (intensity > 0.5) {
                            ctx.strokeStyle = `rgba(240, 200, 40, ${(intensity - 0.5) * 0.8})`;
                            ctx.lineWidth = 4;
                            ctx.stroke(hexPath);
                        }
                    } else if (blobNoise > 0.65) {
                        const intensity = (blobNoise - 0.65) / 0.3;
                        fillStyle = `rgba(160, 210, 40, ${0.05 + intensity * 0.2})`;
                        strokeStyle = `rgba(100, 200, 100, ${0.2 + intensity * 0.4})`;
                        isGlowing = true;
                    }

                    // Always draw base fill and stroke
                    ctx.fillStyle = fillStyle;
                    ctx.fill(hexPath);
                    ctx.strokeStyle = strokeStyle;
                    ctx.lineWidth = 1.5;
                    ctx.stroke(hexPath);

                    // Skip the second heavy inner path stroke unless the hexagon is glowing
                    if (isGlowing) {
                        ctx.strokeStyle = innerHighlight;
                        ctx.lineWidth = 0.5;
                        ctx.stroke(innerHexPath);
                    }

                    ctx.translate(-x, -y);
                }
            }
        };

        const handleResize = () => {
            W = canvas.offsetWidth;
            H = canvas.offsetHeight;
            if (W === 0 || H === 0) return;
            
            canvas.width = Math.floor(W * dpr * renderScale);
            canvas.height = Math.floor(H * dpr * renderScale);
            ctx.scale(dpr * renderScale, dpr * renderScale);
            
            cols = Math.ceil(W / horizSpacing);
            rows = Math.ceil(H / vertSpacing);
            
            // Force redraw immediately so the canvas doesn't flicker blank
            drawFrame();
        };

        handleResize();

        const resizeObserver = new ResizeObserver(() => {
            handleResize();
        });
        resizeObserver.observe(canvas);

        // Pause rendering when canvas is not visible to save CPU
        let isVisible = true;
        const visibilityObserver = new IntersectionObserver(
            ([entry]) => { isVisible = entry.isIntersecting; },
            { threshold: 0 }
        );
        visibilityObserver.observe(canvas);

        let lastTime = performance.now();
        const fpsInterval = 1000 / 12; // 12fps lock — halved from 24fps for dramatic CPU savings

        const render = () => {
            if (animated) {
                animRef.current = requestAnimationFrame(render);
            }

            const now = performance.now();
            const elapsed = now - lastTime;

            if (animated && elapsed < fpsInterval - 0.5) return;
            lastTime = now - (elapsed % fpsInterval);

            // Skip rendering when off-screen to save CPU
            if (!isVisible) return;

            if (animated) timeRef.current += 0.015;
            
            drawFrame();
        };

        render();

        return () => {
            if (animRef.current) cancelAnimationFrame(animRef.current);
            resizeObserver.disconnect();
            visibilityObserver.disconnect();
        };
    }, [animated]);

    return (
        <canvas
            ref={canvasRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0 }}
        />
    );
};

export default HexLatticeCanvas;
