
import React, { useRef, useEffect } from 'react';
import Background3D from './Background3D';

const AuthLayout = ({ children }) => {
    const formRef = useRef(null);

    useEffect(() => {
        const formContainer = formRef.current;

        const handleMouseMove = (e) => {
            if (!formContainer) return;
            const { clientX, clientY } = e;
            const { innerWidth, innerHeight } = window;

            const xRotation = (clientY / innerHeight - 0.5) * -20;
            const yRotation = (clientX / innerWidth - 0.5) * 20;

            formContainer.style.transform = `rotateX(${xRotation}deg) rotateY(${yRotation}deg)`;
        };

        document.addEventListener('mousemove', handleMouseMove);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
        };
    }, []);

    return (
        <div className="auth-page">
            <Background3D />
            <div className="container">
                <div className="form-container" ref={formRef}>
                    {children}
                </div>
            </div>
        </div>
    );
};

export default AuthLayout;
