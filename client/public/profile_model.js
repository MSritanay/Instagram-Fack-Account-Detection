// This file contains the simulated Random Forest model for profile classification.

function predictProfile(features) {
  // This is a simplified, rule-based model that simulates a Random Forest.
  // Each "if" statement can be thought of as a "decision tree" in the forest.
  // The final score is an average of the "votes" from each tree.

  let fakeScore = 0;
  let treeCount = 0;

  // --- Tree 1: Follower/Following Ratio ---
  treeCount++;
  if (features.followerFollowingRatio < 0.1) {
    fakeScore += 0.9; // Strong indicator of a fake account
  } else if (features.followerFollowingRatio < 0.5) {
    fakeScore += 0.5;
  }

  // --- Tree 2: Profile Picture and Posts ---
  treeCount++;
  if (features.hasProfilePic === 0 && features.posts < 5) {
    fakeScore += 0.8;
  }

  // --- Tree 3: Username Characteristics ---
  treeCount++;
  if (features.usernameDigitCount > 4) {
    fakeScore += 0.7;
  }

  // --- Tree 4: Account Activity ---
  treeCount++;
  if (features.posts === 0 && features.followers < 20) {
    fakeScore += 0.6;
  }
  
  // --- Tree 5: Extreme Following ---
  treeCount++;
  if (features.following > 2000) {
      fakeScore += 0.75;
  }

  // Calculate the final confidence
  const confidence = fakeScore / treeCount;

  // Make a prediction
  const prediction = confidence > 0.5 ? "Fake" : "Real";

  return { prediction, confidence };
}