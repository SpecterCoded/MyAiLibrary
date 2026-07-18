import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';

interface LogoLoadingProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  fullscreen?: boolean;
}

export default function LogoLoading({
  size = 'md',
  label,
  fullscreen = false
}: LogoLoadingProps) {
  // Dimensions mapping for different contexts
  const containerSizes = {
    sm: 'w-10 h-10 rounded-xl',
    md: 'w-16 h-16 rounded-[24px]',
    lg: 'w-24 h-24 rounded-[36px]'
  };

  const iconSizes = {
    sm: 18,
    md: 28,
    lg: 42
  };

  const loaderContent = (
    <div className="flex flex-col items-center justify-center">
      <div className="relative">
        {/* Pulsing Outer Glow Aura */}
        <motion.div
          animate={{
            scale: [1, 1.25, 1],
            opacity: [0.15, 0.4, 0.15],
          }}
          transition={{
            duration: 2.5,
            repeat: Infinity,
            ease: "easeInOut"
          }}
          className={`absolute inset-0 bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600 blur-xl ${
            size === 'sm' ? 'scale-110' : size === 'md' ? 'scale-125' : 'scale-135'
          }`}
        />

        {/* Orbiting Sparkles Particles (Aesthetic Micro-Animations) */}
        {size !== 'sm' && (
          <>
            {[...Array(4)].map((_, i) => {
              const angles = [0, 90, 180, 270];
              const radians = (angles[i] * Math.PI) / 180;
              const radius = size === 'lg' ? 64 : 44;
              const x = Math.cos(radians) * radius;
              const y = Math.sin(radians) * radius;

              return (
                <motion.div
                  key={i}
                  animate={{
                    x: [
                      x, 
                      Math.cos(radians + Math.PI / 2) * radius, 
                      Math.cos(radians + Math.PI) * radius, 
                      Math.cos(radians + (3 * Math.PI) / 2) * radius, 
                      x
                    ],
                    y: [
                      y, 
                      Math.sin(radians + Math.PI / 2) * radius, 
                      Math.sin(radians + Math.PI) * radius, 
                      Math.sin(radians + (3 * Math.PI) / 2) * radius, 
                      y
                    ],
                    scale: [0.4, 0.9, 0.4, 0.9, 0.4],
                    opacity: [0.2, 0.8, 0.2, 0.8, 0.2]
                  }}
                  transition={{
                    duration: 4 + i,
                    repeat: Infinity,
                    ease: "linear"
                  }}
                  className="absolute left-1/2 top-1/2 w-2 h-2 -ml-1 -mt-1 rounded-full bg-gradient-to-r from-blue-400 to-indigo-500 shadow-md shadow-indigo-400"
                />
              );
            })}
          </>
        )}

        {/* Core Gradient Logo Container */}
        <motion.div
          animate={{
            y: [0, -6, 0],
            scale: [1, 1.03, 1]
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut"
          }}
          className={`${containerSizes[size]} bg-gradient-to-br from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-600/30 border border-white/25 relative z-10`}
        >
          {/* Central Logo Sparkles Icon */}
          <motion.div
            animate={{
              rotate: [0, 15, -15, 0],
              scale: [1, 1.1, 0.95, 1]
            }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: "easeInOut"
            }}
          >
            <Sparkles
              size={iconSizes[size]}
              className="text-white drop-shadow-[0_2px_8px_rgba(255,255,255,0.4)]"
              strokeWidth={2}
            />
          </motion.div>
        </motion.div>
      </div>

      {/* Label under loader */}
      {label && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 text-center select-none"
        >
          <span className="text-sm font-extrabold tracking-widest text-slate-800 uppercase bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 bg-clip-text text-transparent animate-pulse">
            {label}
          </span>
        </motion.div>
      )}
    </div>
  );

  if (fullscreen) {
    return (
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4, ease: "easeInOut" }}
        className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-white/40 backdrop-blur-2xl"
      >
        {loaderContent}
      </motion.div>
    );
  }

  return loaderContent;
}
