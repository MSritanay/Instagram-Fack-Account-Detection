
import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import './pages.css';

const ForgotPassword: React.FC = () => {
    const [email, setEmail] = useState('');
    const formRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const formContainer = formRef.current;

        const handleMouseMove = (e: MouseEvent) => {
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        // Handle forgot password logic here
        alert(`Password reset link sent to ${email}`);
    };

    return (
        <div className="auth-page">
            <div className="container">
                <div className="form-container" ref={formRef}>
                    <h1>Forgot Password</h1>
                    <form onSubmit={handleSubmit}>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="Email"
                            required
                        />
                        <button type="submit">Send Reset Link</button>
                    </form>
                    <p><Link to="/login">Back to Login</Link></p>
                </div>
            </div>
        </div>
    );
};

export default ForgotPassword;
