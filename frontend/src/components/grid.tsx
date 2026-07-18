"use client";
import React, { useState, useEffect } from "react";

// Grid Background Component
export const GridBackground = () => {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      // Get mouse position relative to the viewport
      const { clientX, clientY } = event;
      // Calculate position from the center of the screen
      const x = clientX - window.innerWidth / 2;
      const y = clientY - window.innerHeight / 2;
      setMousePosition({ x, y });
    };

    window.addEventListener("mousemove", handleMouseMove);

    // Cleanup function to remove the event listener
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden -z-10 pointer-events-none">
      <div
        className="absolute inset-0 opacity-50 transition-transform duration-300 ease-out"
        style={{
          backgroundImage: `
            linear-gradient(to right, var(--grid-color, rgba(0, 0, 0, 0.08)) 1px, transparent 1px),
            linear-gradient(to bottom, var(--grid-color, rgba(0, 0, 0, 0.08)) 1px, transparent 1px)
          `,
          backgroundSize: "40px 40px",
          animation: "moveGrid 20s linear infinite",
          // Apply a subtle transform based on mouse position for a parallax effect
          transform: `translate(${mousePosition.x / 60}px, ${mousePosition.y / 60}px)`,
        }}
      >
        {/* Keyframes for the animation */}
        <style>
          {`
            @keyframes moveGrid {
              0% { background-position: 0 0; }
              100% { background-position: 40px 40px; }
            }
          `}
        </style>
      </div>
    </div>
  );
};

// Main App Component
export default function GridBackgroundView() {
  return (
    <div className="relative w-full h-screen bg-slate-950 overflow-hidden">
      <GridBackground />
      <div className="relative z-10 flex items-center justify-center h-full">
        <div className="text-center px-4">
          <h1 className="text-4xl font-bold text-white md:text-6xl lg:text-8xl">
            Smooth Moving Grid
          </h1>
          <p className="mt-4 text-lg text-slate-300 md:text-xl">
            A dynamic background with mouse-aware parallax effect.
          </p>
        </div>
      </div>
    </div>
  );
}
