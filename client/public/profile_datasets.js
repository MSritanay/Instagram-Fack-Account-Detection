// This file contains a sample dataset for training a profile classification model.
// In a real-world scenario, this dataset would be much larger and used to train
// a model like a Random Forest on a server. For the browser extension, we
// will use a simulated model based on the logic derived from this data.

// Features:
// - posts: Number of posts
// - followers: Number of followers
// - following: Number of users being followed
// - hasProfilePic: 1 if yes, 0 if no
// - isPrivate: 1 if yes, 0 if no
// - usernameLength: Length of the username
// - usernameDigitCount: Number of digits in the username
// - followerFollowingRatio: followers / (following + 1) to avoid division by zero
// - label: 1 for Fake, 0 for Real

const profileDatasets = [
  // --- Fake Profiles ---
  { posts: 0, followers: 10, following: 500, hasProfilePic: 0, isPrivate: 0, usernameLength: 15, usernameDigitCount: 6, followerFollowingRatio: 0.02, label: 1 },
  { posts: 1, followers: 5, following: 200, hasProfilePic: 0, isPrivate: 1, usernameLength: 12, usernameDigitCount: 4, followerFollowingRatio: 0.02, label: 1 },
  { posts: 10, followers: 150, following: 2500, hasProfilePic: 1, isPrivate: 0, usernameLength: 8, usernameDigitCount: 0, followerFollowingRatio: 0.06, label: 1 },
  { posts: 0, followers: 0, following: 10, hasProfilePic: 0, isPrivate: 0, usernameLength: 20, usernameDigitCount: 10, followerFollowingRatio: 0, label: 1 },

  // --- Real Profiles ---
  { posts: 250, followers: 1200, following: 300, hasProfilePic: 1, isPrivate: 0, usernameLength: 9, usernameDigitCount: 0, followerFollowingRatio: 4, label: 0 },
  { posts: 50, followers: 800, following: 400, hasProfilePic: 1, isPrivate: 1, usernameLength: 11, usernameDigitCount: 1, followerFollowingRatio: 2, label: 0 },
  { posts: 1500, followers: 98500000, following: 92, hasProfilePic: 1, isPrivate: 0, usernameLength: 4, usernameDigitCount: 0, followerFollowingRatio: 1070652, label: 0 }, // e.g., NASA
  { posts: 800, followers: 5000, following: 500, hasProfilePic: 1, isPrivate: 0, usernameLength: 7, usernameDigitCount: 0, followerFollowingRatio: 10, label: 0 },
];

// Note: This variable is not directly used by the prediction logic in the extension,
// as the logic is a pre-built simulation. It serves as a reference for data structure.