
// TensorFlow image analysis is disabled to avoid bundling issues
// Can be re-enabled by loading TensorFlow from CDN
// import * as mobilenet from '@tensorflow-models/mobilenet';
// import * as tf from '@tensorflow/tfjs';

// Stub function - returns empty array
// To enable: Load TensorFlow from CDN and restore original implementation
export async function analyzeImage(imageUrl: string): Promise<string[]> {
    // Image analysis temporarily disabled
    // TODO: Enable when TensorFlow is loaded from CDN
    console.log('Image analysis disabled (imageUrl:', imageUrl, ')');
    return [];
}