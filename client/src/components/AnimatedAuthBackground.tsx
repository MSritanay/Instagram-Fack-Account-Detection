import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Points, PointMaterial, Stars } from '@react-three/drei';
import * as THREE from 'three';
import * as random from 'maath/random/dist/maath-random.esm';

const Shield = () => {
  const mesh = useRef<THREE.Mesh>(null!);
  useFrame((state, delta) => {
    if (mesh.current) {
      mesh.current.rotation.y += delta * 0.2;
      mesh.current.rotation.x += delta * 0.1;
      // Add some mouse tracking for more interaction
      const { x, y } = state.mouse;
      mesh.current.rotation.y += x * delta * 0.5;
      mesh.current.rotation.x += y * delta * 0.5;
    }
  });

  return (
    <mesh ref={mesh} position={[0, 0, 0]} scale={1.5}>
      <sphereGeometry args={[1, 32, 32]} />
      <meshStandardMaterial
        color="#0077ff"
        metalness={0.9}
        roughness={0.1}
        emissive="#0077ff"
        emissiveIntensity={3}
      />
    </mesh>
  );
};

const WaveParticles = (props: JSX.IntrinsicElements['group']) => {
    const ref = useRef<THREE.Group>(null!);
    const [sphere] = useMemo(() => random.inSphere(new Float32Array(5000), { radius: 2.5 }), []);
    useFrame((state, delta) => {
      if(ref.current) {
        ref.current.rotation.x -= delta / 10;
        ref.current.rotation.y -= delta / 15;
        // Add some mouse tracking for more interaction
        const { x, y } = state.mouse;
        ref.current.position.x = THREE.MathUtils.lerp(ref.current.position.x, x * 2, 0.1);
        ref.current.position.y = THREE.MathUtils.lerp(ref.current.position.y, y * 2, 0.1);
      }
    });
    return (
      <group rotation={[0, 0, Math.PI / 4]}>
        <Points ref={ref} positions={sphere} stride={3} frustumCulled={false} {...props}>
          <PointMaterial transparent color="#58a6ff" size={0.015} sizeAttenuation={true} depthWrite={false} />
        </Points>
      </group>
    );
  };

const AnimatedAuthBackground = () => {
  return (
    <Canvas camera={{ position: [0, 0, 5] }}>
      <ambientLight intensity={1.5} />
      <pointLight position={[10, 10, 10]} intensity={2} />
      <Shield />
      <WaveParticles />
      <Stars
        radius={100}
        depth={50}
        count={5000}
        factor={4}
        saturation={0}
        fade
      />
    </Canvas>
  );
};

export default AnimatedAuthBackground;