const { ethers } = require("ethers");
const oldPowAbi = require("./oldPowAbi");
const newPowAbi = require("./powAbi.json")

const infuraUrl = "https://sepolia-rollup.arbitrum.io/rpc";
const oldContractAddress = "0x8b852ba45293d6dd51b10c57625c6c5f25adfb40"; // POW new
const phaseMultiplier = 0.9;
const pointsPerMegaHashesPerSecond = 10;
const clintsConstant = 1.3195;
const slashPcntPerDay = 0.10;

const provider = new ethers.JsonRpcProvider(infuraUrl);
const contract = new ethers.Contract(oldContractAddress, newPowAbi, provider);

async function fetchNodeMetrics() {
  const url = 'https://api-testnet.lilypad.tech/metrics-dashboard/leaderboard';

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const data = await response.json();

    // Loop through each node and process its wallet address
    for (const node of data) {
      const walletAddress = node.Wallet;
      console.log(`Processing node with wallet address: ${walletAddress} \n`);
      await calculateRewardsForDay(walletAddress);
      console.log("---------------------------------------------------------")
    }
  } catch (error) {
    console.error('Error fetching node metrics:', error);
  }
}

function detectCurrentPhase() {
  const startDate = new Date('2024-01-01');
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
    const submissionCount = await contract.getMinerPowSubmissions(walletAddress);

    const submissionArray = submissionCount.toArray().length;
    for (let i = 0; i < submissionArray; i++) {
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
  submissions.sort((a, b) => Number(a.start_timestap) - Number(b.start_timestap));
  let totalHashRate = 0;
  let contiguousSubmissions = [];

  for (let i = 0; i < submissions.length; i++) {
    const currentSubmission = submissions[i];
    const currentStartTime = Number(currentSubmission.start_timestap);
    const previousSubmission = contiguousSubmissions.length > 0 ? contiguousSubmissions[contiguousSubmissions.length - 1] : null;
    const previousEndTime = previousSubmission ? Number(previousSubmission.complete_timestap) : null;

    if (previousEndTime === null || isValid4HourSequence(previousEndTime, currentStartTime)) {
      contiguousSubmissions.push(currentSubmission);
    } else {
      if (contiguousSubmissions.length >= 4) {
        for (const submission of contiguousSubmissions) {
          totalHashRate += Number(submission.nonce);
        }
      }
      contiguousSubmissions = [currentSubmission];
    }
  }

  if (contiguousSubmissions.length >= 4) {
    for (const submission of contiguousSubmissions) {
      totalHashRate += Number(submission?.nonce);
    }
  }

  return totalHashRate;
}

async function calculateRewardsForDay(walletAddress) {
  const phaseNumber = detectCurrentPhase();
  console.log(`Phase number: ${phaseNumber}`);

  const phaseMultiplierValue = Math.pow(phaseMultiplier, phaseNumber);
  console.log(`Phase multiplier value (0.9^${phaseNumber}): ${phaseMultiplierValue}`);

  const basePointsAvailableThisPhase = pointsPerMegaHashesPerSecond * phaseMultiplierValue;
  console.log(`Base points available this phase (10 * ${phaseMultiplierValue}): ${basePointsAvailableThisPhase}`);

  const fourHourWindowCount = await countOf4HourWindows(walletAddress);
  console.log(`Number of 4-hour windows for ${walletAddress}: ${fourHourWindowCount}`);

  if (fourHourWindowCount < 1) {
    const slashedRewards = await slashRewards(walletAddress);
    console.log(`Rewards have been slashed for ${walletAddress}: ${slashedRewards}`);
    return;
  }

  const totalHashRate = await sumOfWalletAddressHashRatesForDay(walletAddress);
  console.log(`Total hash rate for ${walletAddress}: ${totalHashRate}`);

  const clintsConstantFactor = Math.pow(clintsConstant, fourHourWindowCount - 1);
  console.log(`Clint's constant factor (1.3195^(${fourHourWindowCount} - 1)): ${clintsConstantFactor}`);

  const rewards = basePointsAvailableThisPhase * totalHashRate * clintsConstantFactor;
  console.log(`Calculated rewards for ${walletAddress}: ${rewards}`);

  await saveRewardsToDatabase(walletAddress, rewards);
}
// }

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
  return currentStartTime - previousEndTime <= 14400;
}

// Call the function to fetch node metrics and process each node
fetchNodeMetrics();
