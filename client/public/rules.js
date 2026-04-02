document.addEventListener('DOMContentLoaded', () => {
    const timerDisplay = document.getElementById('timer');
    const slideshowContainer = document.querySelector('.slideshow-container');
    const bikeContainer = document.querySelector('.bike-animation-container');
    let slides = [];
    let currentSlideIndex = 0;
    let countdown;
    let slideshowInterval;
    let isPaused = false;
    let remainingTime;

    slideshowContainer.addEventListener('click', () => {
        if (!isPaused) {
            isPaused = true;
            clearInterval(slideshowInterval);
            clearInterval(countdown);
        }
    });

    slideshowContainer.addEventListener('dblclick', () => {
        if (isPaused) {
            isPaused = false;
            startSlideshow(false); // Don't reset the slide index
            startTimer(remainingTime);
        }
    });

    // 1. Fetch and Parse Rules
    async function loadRules() {
        try {
            const response = await fetch('rules.txt');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const text = await response.text();
            const sections = text.split('---').filter(s => s.trim() !== '');
            
            slideshowContainer.innerHTML = '<div class="shield"></div>'; // Clear existing content and add shield
            
            sections.forEach((section) => {
                const slide = document.createElement('div');
                slide.className = 'slide';
                
                const lines = section.trim().split('\n').filter(line => line.trim() !== '');
                const title = lines.shift().replace(/###/g, '').trim();
                
                const bodyHtml = lines.map(line => {
                    const cleanedLine = line.replace(/^[\*#\-]\s*/, '').replace(/\*\*/g, '').trim();
                    if (cleanedLine) {
                        if (cleanedLine.endsWith(':') && !line.startsWith('-')) {
                            return `<h4>${cleanedLine}</h4>`;
                        }
                        return `<p>${cleanedLine}</p>`;
                    }
                    return '';
                }).join('');

                slide.innerHTML = `<h3>${title}</h3><div>${bodyHtml}</div>`;
                slideshowContainer.appendChild(slide);
            });

            slides = slideshowContainer.querySelectorAll('.slide');
            if (slides.length > 0) {
                startSlideshow();
            }

        } catch (error) {
            console.error("Error loading rules:", error);
            slideshowContainer.innerHTML = '<div class="slide active"><h3>Error</h3><p>Could not load safety rules. Please try again later.</p></div>';
            document.querySelector('.slide').classList.add('active');
        }
    }

    // 2. Slideshow Logic
    function showSlide(index) {
        document.querySelector('.shield').style.display = 'none';
        slides.forEach((slide, i) => {
            slide.classList.toggle('active', i === index);
        });

        // Trigger bike animation by replacing the element
        const bike = bikeContainer.querySelector('.police-bike');
        if (bike) {
            const newBike = bike.cloneNode(true);
            bike.parentNode.replaceChild(newBike, bike);
        }
    }

    function nextSlide() {
        currentSlideIndex = (currentSlideIndex + 1) % slides.length;
        showSlide(currentSlideIndex);
    }

    function startSlideshow(reset = true) {
        if (slides.length === 0) return;
        if (reset) showSlide(currentSlideIndex);
        slideshowInterval = setInterval(nextSlide, 5000); // Change slide every 5 seconds
    }

    // 3. Countdown Timer
    function startTimer(duration) {
        let timer = duration;
        remainingTime = duration;
        countdown = setInterval(() => {
            remainingTime--;
            const minutes = Math.floor(timer / 60);
            let seconds = timer % 60;
            seconds = seconds < 10 ? '0' + seconds : seconds;
            timerDisplay.textContent = `${minutes}:${seconds}`;
            timer--;

            if (timer < 30) {
                document.body.classList.add('closing-animation');
            }

            if (timer < 0) {
                clearInterval(countdown);
                document.getElementById('permission-section').style.display = 'flex';
                document.querySelector('.rules-section').style.display = 'none';
                document.querySelector('.timer-section').style.display = 'none';
                document.querySelector('.header').style.display = 'none';
                document.body.classList.remove('closing-animation');
                timerDisplay.textContent = "0:00";
            }
        }, 1000);
    }

    // 4. Event Listeners for Permission Buttons
    document.getElementById('continueBtn').addEventListener('click', () => {
        const returnUrl = new URLSearchParams(window.location.search).get('return_url');
        if (returnUrl) {
            window.location.href = returnUrl;
        }
    });

    document.getElementById('exitBtn').addEventListener('click', () => {
        // This will close the tab, but browser security may prevent this
        // unless the script opened the tab.
        window.close();
        // As a fallback, inform the user.
        document.body.innerHTML = '<h1>You can now close this tab.</h1>';
    });

    // Initializations
    loadRules();
    startTimer(120); // 2-minute timer
});