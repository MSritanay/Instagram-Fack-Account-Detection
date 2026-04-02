
import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Points, PointMaterial } from '@react-three/drei';
import * as random from 'maath/random/dist/maath-random.esm';

const Starfield = (props) => {
    const ref = useRef();
    const [sphere] = useMemo(() => {
        const points = random.inSphere(new Float32Array(5000), { radius: 1.2 });
        // Ensure the array has a length that is a multiple of 3
        if (points.length % 3 !== 0) {
            return [new Float32Array(0)];
        }
        return [points];
    }, []);

    useFrame((state, delta) => {
        if (ref.current) {
            ref.current.rotation.x -= delta / 10;
            ref.current.rotation.y -= delta / 15;
        }
    });

    return (
        <group rotation={[0, 0, Math.PI / 4]}>
            <Points ref={ref} positions={sphere} stride={3} frustumCulled {...props}>
                <PointMaterial
                    transparent
                    color="#ffffff"
                    size={0.005}
                    sizeAttenuation={true}
                    depthWrite={false}
                />
            </Points>
        </group>
    );
};

const Background3D = () => {
    return (
        <div style={{ width: '100vw', height: '100vh', position: 'fixed', top: 0, left: 0, zIndex: -1 }}>
            <Canvas camera={{ position: [0, 0, 1] }}>
                <Starfield />
            </Canvas>
        </div>
    );
};

export default Background3D;