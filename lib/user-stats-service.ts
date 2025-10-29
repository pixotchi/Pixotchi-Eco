import { 
  getPlantsByOwner, 
  getLandsByOwner, 
  getTokenBalance, 
  getLeafBalance,
  getVillageBuildingsByLandId,
  getTownBuildingsByLandId,
  getLandBuildingsBatch
} from './contracts';
import { 
  formatTokenAmount, 
  formatScore, 
  formatNumber, 
  getPlantStatusText,
  getStrainName,
  formatDuration,
  formatLargeNumber
} from './utils';
import { Plant, Land, BuildingData } from './types';
import { redis } from './redis';
import { VILLAGE_BUILDING_NAMES, TOWN_BUILDING_NAMES } from './constants';

// Building type names as shown to users
const getVillageBuildingName = (buildingId: number): string => {
  return VILLAGE_BUILDING_NAMES[buildingId as keyof typeof VILLAGE_BUILDING_NAMES] || `Village Building ${buildingId}`;
};

const getTownBuildingName = (buildingId: number): string => {
  return TOWN_BUILDING_NAMES[buildingId as keyof typeof TOWN_BUILDING_NAMES] || `Town Building ${buildingId}`;
};

// User stats interface matching what AI should receive
export interface UserGameStats {
  // Plant Stats
  totalPlants: number;
  healthyPlants: number;
  dyingPlants: number;
  totalPTS: number;
  totalRewards: number;
  totalStars: number;
  avgLevel: number;
  
  // Detailed Plant Information (per-plant breakdown)
  plantDetails: Array<{
    id: number;
    name: string;
    strain: number;
    strainName: string;
    level: number;
    status: number;
    statusText: string;
    score: number;
    formattedScore: string;
    rewards: number;
    formattedRewards: string;
    stars: number;
    timeUntilStarving: number;
    timeUntilStarvingDisplay: string;
    urgency: 'critical' | 'warning' | 'ok';
    timePlantBorn: string;
    hasActiveFence: boolean;
    activeItems: Array<{
      name: string;
      effectIsOngoingActive: boolean;
    }>;
  }>;
  
  // Land Stats
  totalLands: number;
  totalLandXP: number;
  totalStoredPTS: number;
  totalStoredTOD: number;
  
  // Detailed Land Information (per-land breakdown)
  landDetails: Array<{
    tokenId: string;
    name: string;
    coordinates: { x: number; y: number };
    experiencePoints: number;
    storedPTS: number;
    storedTOD: number;
    villageBuildings: Array<{
      type: string;
      level: number;
      dailyPTSProduction: number;
      dailyTODProduction: number;
      unclaimedPTS: number;
      unclaimedTOD: number;
    }>;
    townBuildings: Array<{
      type: string;
      level: number;
      dailyPTSProduction: number;
      dailyTODProduction: number;
      unclaimedPTS: number;
      unclaimedTOD: number;
    }>;
  }>;
  
  // Aggregated Building Stats (legacy for compatibility)
  villageBuildings: Array<{
    type: string;
    level: number;
    dailyPTSProduction: number;
    dailyTODProduction: number;
  }>;
  townBuildings: Array<{
    type: string;
    level: number;
    dailyPTSProduction: number;
    dailyTODProduction: number;
  }>;
  totalDailyPTSProduction: number;
  totalDailyTODProduction: number;
  unclaimedPTS: number;
  unclaimedTOD: number;
  
  // Financial Stats (formatted as shown to users)
  formattedSeedBalance: string;
  formattedLeafBalance: string;
  
  // Additional context (legacy - now redundant with plantDetails)
  plantsNeedingCare: Array<{
    id: number;
    name: string;
    status: string;
    timeUntilStarving: string;
    urgency: 'critical' | 'warning' | 'ok';
  }>;
  
  timestamp: number;
}

const USER_STATS_TTL = 30; // 30 seconds cache

export async function getUserGameStats(address: string): Promise<UserGameStats> {
  if (!address) {
    throw new Error('Address is required');
  }

  // Try to get cached stats first
  const cacheKey = `user:stats:${address.toLowerCase()}`;
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached && typeof cached === 'string') {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.error('Error reading cached user stats:', error);
    }
  }

  console.log(`🔄 Fetching fresh user stats for ${address.slice(0, 6)}...`);

  try {
    // Fetch all user data in parallel
    const [plants, lands, seedBalance, leafBalance] = await Promise.all([
      getPlantsByOwner(address),
      getLandsByOwner(address),
      getTokenBalance(address),
      getLeafBalance(address)
    ]);

    // Calculate plant stats
    const totalPlants = plants.length;
    const healthyPlants = plants.filter(p => p.status <= 1).length; // Great (0) or Okay (1)
    const dyingPlants = plants.filter(p => p.status >= 2).length; // Dry (2), Dying (3), Dead (4)
    const totalPTS = plants.reduce((sum, p) => sum + (p.score / 1e12), 0); // Plant scores use 12 decimals
    const totalRewards = plants.reduce((sum, p) => sum + (p.rewards / 1e18), 0); // Rewards use 18 decimals (ETH)
    const totalStars = plants.reduce((sum, p) => sum + p.stars, 0);
    const avgLevel = totalPlants > 0 ? plants.reduce((sum, p) => sum + p.level, 0) / totalPlants : 0;

    // Calculate land stats
    const totalLands = lands.length;
    const totalLandXP = lands.reduce((sum, l) => sum + Number(l.experiencePoints), 0);
    const totalStoredPTS = lands.reduce((sum, l) => sum + Number(l.accumulatedPlantPoints), 0);
    const totalStoredTOD = lands.reduce((sum, l) => sum + Number(l.accumulatedPlantLifetime), 0);

    // Fetch building data for all lands
    let villageBuildings: Array<{ type: string; level: number; dailyPTSProduction: number; dailyTODProduction: number; }> = [];
    let townBuildings: Array<{ type: string; level: number; dailyPTSProduction: number; dailyTODProduction: number; }> = [];
    let totalDailyPTSProduction = 0;
    let totalDailyTODProduction = 0;
    let unclaimedPTS = 0;
    let unclaimedTOD = 0;
 
    const landBuildingMap = new Map<string, { village: any[]; town: any[] }>();
    if (lands.length > 0) {
      try {
        const batchedBuildings = await getLandBuildingsBatch(
          lands.map((land) => (typeof land.tokenId === 'bigint' ? land.tokenId : BigInt(land.tokenId))),
        );
        batchedBuildings.forEach(({ landId, villageBuildings, townBuildings }) => {
          landBuildingMap.set(landId.toString(), {
            village: Array.isArray(villageBuildings) ? villageBuildings : [],
            town: Array.isArray(townBuildings) ? townBuildings : [],
          });
        });
      } catch (error) {
        console.error('Batch building fetch failed; falling back to per-land requests', error);
      }
    }

    // Detailed land information for AI
    const landDetails: Array<{
      tokenId: string;
      name: string;
      coordinates: { x: number; y: number };
      experiencePoints: number;
      storedPTS: number;
      storedTOD: number;
      villageBuildings: Array<{
        type: string;
        level: number;
        dailyPTSProduction: number;
        dailyTODProduction: number;
        unclaimedPTS: number;
        unclaimedTOD: number;
      }>;
      townBuildings: Array<{
        type: string;
        level: number;
        dailyPTSProduction: number;
        dailyTODProduction: number;
        unclaimedPTS: number;
        unclaimedTOD: number;
      }>;
    }> = [];

    for (const land of lands) {
      try {
        let villageData: any[] = [];
        let townData: any[] = [];
        const landKey = land.tokenId.toString();
        const preloaded = landBuildingMap.get(landKey);
        if (preloaded) {
          villageData = preloaded.village ?? [];
          townData = preloaded.town ?? [];
        } else {
          [villageData, townData] = await Promise.all([
            getVillageBuildingsByLandId(land.tokenId),
            getTownBuildingsByLandId(land.tokenId)
          ]);
        }

        // Process buildings for this specific land
        const landVillageBuildings: Array<{
          type: string;
          level: number;
          dailyPTSProduction: number;
          dailyTODProduction: number;
          unclaimedPTS: number;
          unclaimedTOD: number;
        }> = [];
        
        const landTownBuildings: Array<{
          type: string;
          level: number;
          dailyPTSProduction: number;
          dailyTODProduction: number;
          unclaimedPTS: number;
          unclaimedTOD: number;
        }> = [];

        // Process village buildings
        villageData.forEach((building: any) => {
          if (building.level > 0) { // Only include built buildings
            const dailyPTS = Number(building.productionRatePlantPointsPerDay) / 1e12; // Production rates use 12 decimals
            const dailyTOD = Number(building.productionRatePlantLifetimePerDay); // TOD values are already in seconds
            const buildingUnclaimedPTS = Number(building.accumulatedPoints) / 1e18; // Accumulated amounts use 18 decimals
            const buildingUnclaimedTOD = Number(building.accumulatedLifetime); // TOD values are already in seconds
            
            const buildingInfo = {
              type: getVillageBuildingName(building.id),
              level: building.level,
              dailyPTSProduction: dailyPTS,
              dailyTODProduction: dailyTOD,
              unclaimedPTS: buildingUnclaimedPTS,
              unclaimedTOD: buildingUnclaimedTOD
            };
            
            // Add to per-land data
            landVillageBuildings.push(buildingInfo);
            
            // Add to aggregated data (legacy)
            villageBuildings.push({
              type: buildingInfo.type,
              level: buildingInfo.level,
              dailyPTSProduction: buildingInfo.dailyPTSProduction,
              dailyTODProduction: buildingInfo.dailyTODProduction
            });
            
            totalDailyPTSProduction += dailyPTS;
            totalDailyTODProduction += dailyTOD;
            unclaimedPTS += buildingUnclaimedPTS;
            unclaimedTOD += buildingUnclaimedTOD;
          }
        });

        // Process town buildings (including prebuilt Stake House and Warehouse)
        const prebuiltTownBuildings = [
          { id: 1, level: 1 }, // Stake House
          { id: 3, level: 1 }  // Warehouse
        ];
        
        // Add prebuilt buildings first
        prebuiltTownBuildings.forEach((prebuilt) => {
          landTownBuildings.push({
            type: getTownBuildingName(prebuilt.id),
            level: prebuilt.level,
            dailyPTSProduction: 0,
            dailyTODProduction: 0,
            unclaimedPTS: 0,
            unclaimedTOD: 0
          });
        });
        
        // Process additional town buildings from contract
        townData.forEach((building: any) => {
          if (building.level > 0 && building.id !== 1 && building.id !== 3) { // Exclude prebuilt buildings
            const dailyPTS = Number(building.productionRatePlantPointsPerDay) / 1e12; // Production rates use 12 decimals
            const dailyTOD = Number(building.productionRatePlantLifetimePerDay); // TOD values are already in seconds
            const buildingUnclaimedPTS = Number(building.accumulatedPoints) / 1e18; // Accumulated amounts use 18 decimals
            const buildingUnclaimedTOD = Number(building.accumulatedLifetime); // TOD values are already in seconds
            
            const buildingInfo = {
              type: getTownBuildingName(building.id),
              level: building.level,
              dailyPTSProduction: dailyPTS,
              dailyTODProduction: dailyTOD,
              unclaimedPTS: buildingUnclaimedPTS,
              unclaimedTOD: buildingUnclaimedTOD
            };
            
            // Add to per-land data
            landTownBuildings.push(buildingInfo);
            
            // Add to aggregated data (legacy)
            townBuildings.push({
              type: buildingInfo.type,
              level: buildingInfo.level,
              dailyPTSProduction: buildingInfo.dailyPTSProduction,
              dailyTODProduction: buildingInfo.dailyTODProduction
            });
            
            totalDailyPTSProduction += dailyPTS;
            totalDailyTODProduction += dailyTOD;
            unclaimedPTS += buildingUnclaimedPTS;
            unclaimedTOD += buildingUnclaimedTOD;
          }
        });

        // Add this land's details
        landDetails.push({
          tokenId: land.tokenId.toString(),
          name: land.name || `Land #${land.tokenId}`,
          coordinates: {
            x: Number(land.coordinateX),
            y: Number(land.coordinateY)
          },
          experiencePoints: Math.round(Number(land.experiencePoints) / 1e18),
          storedPTS: Math.round(Number(land.accumulatedPlantPoints) / 1e18),
          storedTOD: Math.round(Number(land.accumulatedPlantLifetime) / 1e18),
          villageBuildings: landVillageBuildings,
          townBuildings: landTownBuildings
        });
      } catch (error) {
        console.error(`Error fetching buildings for land ${land.tokenId}:`, error);
        // Add land with empty buildings if fetch fails
        landDetails.push({
          tokenId: land.tokenId.toString(),
          name: land.name || `Land #${land.tokenId}`,
          coordinates: {
            x: Number(land.coordinateX),
            y: Number(land.coordinateY)
          },
          experiencePoints: Math.round(Number(land.experiencePoints) / 1e18),
          storedPTS: Math.round(Number(land.accumulatedPlantPoints) / 1e18),
          storedTOD: Math.round(Number(land.accumulatedPlantLifetime) / 1e18),
          villageBuildings: [],
          townBuildings: [
            {
              type: "Stake House",
              level: 1,
              dailyPTSProduction: 0,
              dailyTODProduction: 0,
              unclaimedPTS: 0,
              unclaimedTOD: 0
            },
            {
              type: "Ware House",
              level: 1,
              dailyPTSProduction: 0,
              dailyTODProduction: 0,
              unclaimedPTS: 0,
              unclaimedTOD: 0
            }
          ]
        });
      }
    }

    // Format balances exactly as shown to users
    const formattedSeedBalance = formatLargeNumber(seedBalance);
    const formattedLeafBalance = formatLargeNumber(leafBalance);

    // Identify plants needing care (format time exactly as countdown timer shows)
    const plantsNeedingCare = plants
      .filter(p => p.status > 0) // Exclude dead plants
      .map(p => {
        const now = Math.floor(Date.now() / 1000);
        const timeLeft = p.timeUntilStarving - now;
        
        let urgency: 'critical' | 'warning' | 'ok' = 'ok';
        let timeDisplay = '';
        
        if (timeLeft <= 0) {
          timeDisplay = "00h:00m:00s";
          urgency = 'critical';
        } else {
          const hours = Math.floor(timeLeft / 3600);
          const minutes = Math.floor((timeLeft % 3600) / 60);
          const seconds = timeLeft % 60;
          timeDisplay = `${hours.toString().padStart(2, '0')}h:${minutes.toString().padStart(2, '0')}m:${seconds.toString().padStart(2, '0')}s`;
          
          if (timeLeft < 3600) { // Less than 1 hour
            urgency = 'critical';
          } else if (timeLeft < 7200) { // Less than 2 hours
            urgency = 'warning';
          }
        }

        return {
          id: p.id,
          name: p.name || `Plant #${p.id}`,
          status: getPlantStatusText(p.status),
          timeUntilStarving: timeDisplay,
          urgency
        };
      })
      .sort((a, b) => {
        // Sort by urgency: critical first, then warning, then ok
        const urgencyOrder = { critical: 0, warning: 1, ok: 2 };
        return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
      });

    // Create detailed plant information for AI context
    const plantDetails = plants.map(p => {
      const now = Math.floor(Date.now() / 1000);
      const timeLeft = p.timeUntilStarving - now;
      
      let urgency: 'critical' | 'warning' | 'ok' = 'ok';
      let timeDisplay = '';
      
      if (timeLeft <= 0) {
        timeDisplay = "00h:00m:00s";
        urgency = 'critical';
      } else {
        const hours = Math.floor(timeLeft / 3600);
        const minutes = Math.floor((timeLeft % 3600) / 60);
        const seconds = timeLeft % 60;
        timeDisplay = `${hours.toString().padStart(2, '0')}h:${minutes.toString().padStart(2, '0')}m:${seconds.toString().padStart(2, '0')}s`;
        
        if (timeLeft < 3600) { // Less than 1 hour
          urgency = 'critical';
        } else if (timeLeft < 7200) { // Less than 2 hours
          urgency = 'warning';
        }
      }

      // Check for active fence
      const hasActiveFence = p.extensions?.some((extension: any) =>
        extension.shopItemOwned?.some((item: any) => 
          item.effectIsOngoingActive && item.name.toLowerCase().includes('fence')
        )
      ) || false;

      // Get active items
      const activeItems = p.extensions?.flatMap((extension: any) => 
        extension.shopItemOwned?.filter((item: any) => item.effectIsOngoingActive) || []
      ).map((item: any) => ({
        name: item.name,
        effectIsOngoingActive: item.effectIsOngoingActive
      })) || [];

      return {
        id: p.id,
        name: p.name || `Plant #${p.id}`,
        strain: p.strain,
        strainName: getStrainName(p.strain),
        level: p.level,
        status: p.status,
        statusText: getPlantStatusText(p.status),
        score: p.score,
        formattedScore: formatScore(p.score),
        rewards: p.rewards,
        formattedRewards: formatTokenAmount(BigInt(p.rewards), 18) + ' ETH',
        stars: p.stars,
        timeUntilStarving: p.timeUntilStarving,
        timeUntilStarvingDisplay: timeDisplay,
        urgency,
        timePlantBorn: p.timePlantBorn,
        hasActiveFence,
        activeItems
      };
    });

    const stats: UserGameStats = {
      // Plant Stats
      totalPlants,
      healthyPlants,
      dyingPlants,
      totalPTS: Math.round(totalPTS),
      totalRewards: Math.round(totalRewards),
      totalStars,
      avgLevel: Math.round(avgLevel * 10) / 10, // Round to 1 decimal place
      
      // Detailed Plant Information (per-plant breakdown)
      plantDetails,
      
      // Land Stats
      totalLands,
      totalLandXP: Math.round(totalLandXP / 1e18), // Convert from wei
      totalStoredPTS: Math.round(totalStoredPTS / 1e18), // Convert from wei
      totalStoredTOD: Math.round(totalStoredTOD / 1e18), // Convert from wei
      
      // Detailed Land Information (per-land breakdown)
      landDetails,
      
      // Aggregated Building Stats (legacy for compatibility)
      villageBuildings,
      townBuildings,
      totalDailyPTSProduction: Math.round(totalDailyPTSProduction),
      totalDailyTODProduction: Math.round(totalDailyTODProduction),
      unclaimedPTS: Math.round(unclaimedPTS),
      unclaimedTOD: Math.round(unclaimedTOD),
      
      // Financial Stats
      formattedSeedBalance,
      formattedLeafBalance,
      
      // Additional context
      plantsNeedingCare,
      
      timestamp: Date.now()
    };

    // Cache the results
    if (redis) {
      try {
        await redis.set(cacheKey, JSON.stringify(stats), { ex: USER_STATS_TTL });
      } catch (error) {
        console.error('Error caching user stats:', error);
      }
    }

    console.log(`✅ User stats fetched for ${address.slice(0, 6)}:`, {
      plants: totalPlants,
      lands: totalLands,
      seedBalance: formattedSeedBalance,
      leafBalance: formattedLeafBalance,
      plantsNeedingCare: plantsNeedingCare.length
    });

    return stats;

  } catch (error) {
    console.error('Error fetching user game stats:', error);
    throw new Error('Failed to fetch user game statistics');
  }
}

// Helper function to format stats for AI context
export function formatStatsForAI(stats: UserGameStats): string {
  // Create a more readable format for AI with land-by-land breakdown
  const readableStats = {
    // Plant Summary
    plantSummary: {
      totalPlants: stats.totalPlants,
      healthyPlants: stats.healthyPlants,
      dyingPlants: stats.dyingPlants,
      totalPTS: stats.totalPTS,
      totalRewards: stats.totalRewards,
      totalStars: stats.totalStars,
      avgLevel: stats.avgLevel
    },
    
    // Individual Plants (complete details for each plant)
    individualPlants: stats.plantDetails.map(plant => ({
      id: plant.id,
      name: plant.name,
      strain: plant.strainName,
      level: plant.level,
      status: plant.statusText,
      score: plant.formattedScore,
      rewards: plant.formattedRewards,
      stars: plant.stars,
      timeUntilStarving: plant.timeUntilStarvingDisplay,
      urgency: plant.urgency,
      bornDate: plant.timePlantBorn,
      protected: plant.hasActiveFence ? "Protected by fence" : "Not protected",
      activeItems: plant.activeItems.length > 0 ? 
        plant.activeItems.map(item => item.name) : 
        "No active items"
    })),
    
    // Land Summary
    landSummary: {
      totalLands: stats.totalLands,
      totalLandXP: stats.totalLandXP,
      totalStoredPTS: stats.totalStoredPTS,
      totalStoredTOD: stats.totalStoredTOD
    },
    
    // Detailed Land Information (each land with its buildings)
    individualLands: stats.landDetails.map(land => ({
      name: land.name,
      tokenId: land.tokenId,
      coordinates: `(${land.coordinates.x}, ${land.coordinates.y})`,
      experiencePoints: land.experiencePoints,
      storedPTS: land.storedPTS,
      storedTOD: `${(land.storedTOD / 3600).toFixed(2)} hours`, // Convert seconds to hours
      villageBuildings: land.villageBuildings.length > 0 ? 
        land.villageBuildings.map(building => ({
          ...building,
          dailyTODProduction: building.dailyTODProduction > 0 ? 
            `${(building.dailyTODProduction / 3600).toFixed(2)} hours/day` : 
            building.dailyTODProduction,
          unclaimedTOD: building.unclaimedTOD > 0 ? 
            `${(building.unclaimedTOD / 3600).toFixed(2)} hours` : 
            building.unclaimedTOD
        })) : "No village buildings built",
      townBuildings: land.townBuildings.length > 0 ? 
        land.townBuildings.map(building => ({
          ...building,
          dailyTODProduction: building.dailyTODProduction > 0 ? 
            `${(building.dailyTODProduction / 3600).toFixed(2)} hours/day` : 
            building.dailyTODProduction,
          unclaimedTOD: building.unclaimedTOD > 0 ? 
            `${(building.unclaimedTOD / 3600).toFixed(2)} hours` : 
            building.unclaimedTOD
        })) : "Only prebuilt Stake House and Warehouse"
    })),
    
    // Production Summary
    productionSummary: {
      totalDailyPTSProduction: stats.totalDailyPTSProduction,
      totalDailyTODProduction: `${(stats.totalDailyTODProduction / 3600).toFixed(2)} hours/day`,
      unclaimedPTS: stats.unclaimedPTS,
      unclaimedTOD: `${(stats.unclaimedTOD / 3600).toFixed(2)} hours`
    },
    
    // Financial Status
    finances: {
      seedBalance: stats.formattedSeedBalance,
      leafBalance: stats.formattedLeafBalance
    },
    
    // Plants Needing Attention
    plantsNeedingCare: stats.plantsNeedingCare.length > 0 ? stats.plantsNeedingCare : "All plants are healthy",
    
    // Last updated
    lastUpdated: new Date(stats.timestamp).toLocaleString()
  };
  
  return JSON.stringify(readableStats);
}