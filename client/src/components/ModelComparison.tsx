import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "./ui/accordion";
import './ModelComparison.css';

const ModelComparison = () => {
  return (
    <div className="model-comparison-container">
       <div className="header-3d">
        <h2>Model Rationale</h2>
        <div className="scanner-effect"></div>
      </div>
      <Accordion type="single" collapsible className="w-full">
        <AccordionItem value="item-1">
          <AccordionTrigger>Logistic Regression</AccordionTrigger>
          <AccordionContent>
            <p><strong>Advantages:</strong> Simple, fast, and highly interpretable. It's an excellent baseline for understanding feature importance.</p>
            <p><strong>Disadvantages:</strong> Assumes a linear relationship between features and the outcome, which is often not the case with complex data like social media profiles. It can be easily outperformed by more complex models.</p>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="item-2">
          <AccordionTrigger>Random Forest</AccordionTrigger>
          <AccordionContent>
            <p><strong>Advantages:</strong> High accuracy and robust. It handles non-linear data well by combining many decision trees, reducing the risk of overfitting. It's a powerful and reliable choice for classification tasks.</p>
            <p><strong>Disadvantages:</strong> Acts as a "black box," making it difficult to interpret the decision-making process. It can also be slower to train than simpler models.</p>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="item-3">
          <AccordionTrigger>Gradient Boosting</AccordionTrigger>
          <AccordionContent>
            <p><strong>Advantages:</strong> Often achieves state-of-the-art performance by building trees sequentially, where each tree corrects the errors of the previous one. It is highly flexible and powerful.</p>
            <p><strong>Disadvantages:</strong> Can be prone to overfitting if not carefully tuned. The sequential training process can also be computationally intensive.</p>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="item-4">
          <AccordionTrigger>XGBoost</AccordionTrigger>
          <AccordionContent>
            <p><strong>Advantages:</strong> An optimized and high-performance version of Gradient Boosting. It's known for its exceptional speed, accuracy, and built-in regularization that helps prevent overfitting, making it a top choice for competitive machine learning.</p>
            <p><strong>Disadvantages:</strong> Can be complex to tune due to its many hyperparameters. Like other ensemble methods, it is not easily interpretable.</p>
          </AccordionContent>
        </AccordionItem>
         <AccordionItem value="item-5">
          <AccordionTrigger>Why Random Forest & XGBoost?</AccordionTrigger>
          <AccordionContent>
            <p>We chose <strong>Random Forest</strong> as the primary model and <strong>XGBoost</strong> as the backup because they offer a powerful combination of high accuracy and robustness. These models excel at capturing the complex, non-linear patterns found in real-world social media data. This ensemble approach ensures our predictions are both reliable and consistently available, providing a critical layer of intelligence for threat analysis.</p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
};

export default ModelComparison;