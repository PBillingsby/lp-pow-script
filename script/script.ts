const { ethers } = require("ethers");
const oldPowAbi = require("./oldPowAbi");

const infuraUrl = "https://sepolia-rollup.arbitrum.io/rpc";
const oldContractAddress = "0xacDf1005fAb67C13603C19aC5471F0c7dDBc90b2"; // POW old
const phaseMultiplier = 0.9;
const pointsPerMegaHashesPerSecond = 10;
const clintsConstant = 1.3195;
const slashPcntPerDay = 0.10;

const provider = new ethers.JsonRpcProvider(infuraUrl);
const contract = new ethers.Contract(oldContractAddress, oldPowAbi, provider);

async function fetchNodeMetrics() {
  const url = 'https://api-testnet.lilypad.tech/metrics-dashboard/nodes';

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();

    // Loop through each node and process its wallet address
    for (const node of data) {
      const walletAddress = node.ID;
      console.log(`Processing node with wallet address: ${walletAddress} \n`);
      await calculateRewardsForDay(walletAddress);
      console.log("---------------------------------------------------------")
    }
  } catch (error) {
    console.error('Error fetching node metrics:', error);
  }
}

function detectCurrentPhase() {
  const startDate = new Date('2024-01-01'); // Change this to reflect the actual start date of the phases
  const currentDate = new Date();
  const phaseLengthDays = 14;
  const phaseNumber = Math.floor((currentDate - startDate) / (phaseLengthDays * 24 * 60 * 60 * 1000));
  return phaseNumber;
}

async function sumOfWalletAddressHashRatesForDay(walletAddress) {
  try {
    const submissions = await getAllPoWSubmissionsForDay(walletAddress);
    const totalHashRate = sumHashRates(submissions);
    return totalHashRate;
  } catch (error) {
    console.error("Error summing hash rates:", error);
  }
}

async function getAllPoWSubmissionsForDay(walletAddress) {
  try {
    const submissions = [];
    const submissionCount = await contract.minerSubmissionCount(walletAddress);

    for (let i = 0; i < submissionCount; i++) {
      const submission = await contract.powSubmissions(walletAddress, i);
      const formattedSubmission = {
        walletAddress: submission[0],
        nodeId: submission[1],
        nonce: submission[2],
        start_timestap: submission[3],
        complete_timestap: submission[4],
        challenge: submission[5],
        difficulty: submission[6]
      };
      submissions.push(formattedSubmission);
    }

    return submissions;
  } catch (error) {
    console.error("Error fetching PoW submissions:", error);
  }
}

function sumHashRates(submissions) {
  // Sort submissions by start timestamp in ascending order
  submissions.sort((a, b) => Number(a.start_timestap) - Number(b.start_timestap));
  let totalHashRate = 0;
  let contiguousSubmissions = [];

  for (let i = 0; i < submissions.length; i++) {
    const currentSubmission = submissions[i];
    const currentStartTime = Number(currentSubmission.start_timestap);
    const previousSubmission = contiguousSubmissions.length > 0 ? contiguousSubmissions[contiguousSubmissions.length - 1] : null;
    const previousEndTime = previousSubmission ? Number(previousSubmission.complete_timestap) : null;

    // Check if this submission is part of a contiguous 4-hour sequence
    if (previousEndTime === null || isValid4HourSequence(previousEndTime, currentStartTime)) {
      contiguousSubmissions.push(currentSubmission);
    } else {
      // If the previous contiguous sequence has at least 4 submissions, sum their hash rates
      if (contiguousSubmissions.length >= 4) {
        for (const submission of contiguousSubmissions) {
          totalHashRate += Number(submission.nonce);
        }
      }
      // Start a new contiguous sequence with the current submission
      contiguousSubmissions = [currentSubmission];
    }
  }

  // Process the last contiguous sequence if it has at least 4 submissions
  if (contiguousSubmissions.length >= 4) {
    for (const submission of contiguousSubmissions) {
      totalHashRate += Number(submission.nonce);
    }
  }

  return totalHashRate;
}

async function calculateRewardsForDay(walletAddress) {
  const phaseNumber = detectCurrentPhase();

  // Calculate the phase multiplier value based on the current phase
  const phaseMultiplierValue = Math.pow(phaseMultiplier, phaseNumber);

  // Calculate the base points available for the current phase
  const basePointsAvailableThisPhase = pointsPerMegaHashesPerSecond * phaseMultiplierValue;

  // Count the number of 4-hour windows of valid PoW submissions for the wallet address
  const fourHourWindowCount = await countOf4HourWindows(walletAddress);

  // If there are no valid 4-hour windows, apply slashing to the rewards
  if (fourHourWindowCount < 1) {
    await slashRewards(walletAddress);
  } else {
    // Sum the total hash rate for the wallet address for the day
    const totalHashRate = await sumOfWalletAddressHashRatesForDay(walletAddress);

    // Calculate the rewards based on the base points, total hash rate, and the number of 4-hour windows
    const rewards = basePointsAvailableThisPhase * totalHashRate * Math.pow(clintsConstant, fourHourWindowCount - 1);

    // Save the calculated rewards to the database
    await saveRewardsToDatabase(walletAddress, rewards);
  }
}

async function saveRewardsToDatabase(walletAddress, rewards) {
  console.log(`Saving rewards for ${walletAddress}: ${rewards}`);
  // Add your database saving logic here
}

async function getSumOfRewardsForWalletAddressSoFar(walletAddress) {
  // console.log(`Fetching sum of rewards for ${walletAddress} from database`);
  // Add your database fetching logic here
  return 0; // Placeholder return value
}

async function slashRewards(walletAddress) {
  const rewards = await getSumOfRewardsForWalletAddressSoFar(walletAddress);
  const slashedRewards = (1 - slashPcntPerDay) * rewards;
  console.log(`Slashed rewards for ${walletAddress}: ${slashedRewards}`);
  return slashedRewards;
}

async function countOf4HourWindows(walletAddress) {
  const submissions = await getAllPoWSubmissionsForDay(walletAddress);
  const fourHourWindowCount = Math.floor(submissions.length / 4);
  return fourHourWindowCount;
}

function isValid4HourSequence(previousEndTime, currentStartTime) {
  return currentStartTime - previousEndTime <= 14400; // 4 hours in seconds
}

// Call the function to fetch node metrics and process each node
fetchNodeMetrics();
