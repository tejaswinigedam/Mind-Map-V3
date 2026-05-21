// @ts-nocheck — legacy test
import { GeminiService } from './services/GeminiService';
import { ExtractedIntent } from './orchestrator/types';

async function testGeneration() {
  console.log('=== Starting Mind Map Generation Test ===');
  
  const mockIntent: ExtractedIntent = {
    goals: ['Learn skincare concepts'],
    useCase: 'Knowledge Discovery & Conceptual Synthesis',
    learningStyle: 'Systemic & Analytical',
    explorationDepth: 'strategic', // Strategic triggers 5 levels!
    expertiseLevel: 'Advanced',
    breadthPreference: 'balanced'
  };

  const mockExpansion = {
    missingAreas: [],
    relatedConcepts: [],
    hiddenBranches: [],
    recommendedPerspectives: []
  };

  const mockStructure = {
    clusters: [],
    hierarchy: [],
    flowOrder: []
  };

  try {
    const result = await GeminiService.generateMindMap(
      'kids diet',
      mockIntent,
      mockExpansion,
      mockStructure
    );

    console.log(`\nGenerated ${result.nodes.length} nodes and ${result.edges.length} edges!`);

    // Verify depth and labels
    const depthCounts: Record<number, number> = {};
    const detailsCount = { withGenericDetail: 0, withDomainLabel: 0 };
    const coordinatePairs = new Set<string>();
    let hasOverlaps = false;

    result.nodes.forEach((node: any) => {
      const d = node.data.depth || 0;
      depthCounts[d] = (depthCounts[d] || 0) + 1;

      if (node.data.label.includes('Detail A') || node.data.label.includes('Detail B')) {
        detailsCount.withGenericDetail++;
      } else {
        detailsCount.withDomainLabel++;
      }

      // Check coordinates for overlapping
      const posKey = `${node.position.x},${node.position.y}`;
      if (coordinatePairs.has(posKey)) {
        console.error(`❌ OVERLAP DETECTED at position: ${posKey} (Node: ${node.id} - ${node.data.label})`);
        hasOverlaps = true;
      }
      coordinatePairs.add(posKey);
    });

    console.log('\n--- Node Distribution by Depth ---');
    Object.keys(depthCounts).forEach(depth => {
      console.log(`Depth ${depth}: ${depthCounts[Number(depth)]} nodes`);
    });

    console.log('\n--- Node Label Verification ---');
    console.log(`Domain-specific labels: ${detailsCount.withDomainLabel}`);
    console.log(`Generic "Detail A/B" labels: ${detailsCount.withGenericDetail}`);

    if (detailsCount.withGenericDetail === 0) {
      console.log('✅ Success! Zero generic "Detail" labels found.');
    } else {
      console.error('❌ Failed! Found generic labels.');
    }

    if (!hasOverlaps) {
      console.log('✅ Success! Zero coordinate overlaps detected across all 5 levels.');
    } else {
      console.error('❌ Failed! Overlapping coordinates found.');
    }

    // Print a sample branch down to 5 levels
    console.log('\n--- Sample 5-Level Deep Branch Walk ---');
    let currentNodeId = 'root';
    console.log(`Level 0: [${result.nodes.find((n: any) => n.id === 'root')?.data.label}]`);
    
    for (let level = 1; level <= 5; level++) {
      const childA = result.nodes.find((n: any) => n.id === `${currentNodeId}_a` || n.id === `sk${level}_a` || (level === 1 && n.id === 'sk1'));
      if (childA) {
        console.log(`Level ${level}: [${childA.data.label}] -> ID: ${childA.id} @ (${childA.position.x}, ${childA.position.y})`);
        currentNodeId = childA.id;
      } else {
        // Fallback search for any child at this depth
        const depthNodes = result.nodes.filter((n: any) => n.data.depth === level && n.id.startsWith(currentNodeId));
        if (depthNodes.length > 0) {
          console.log(`Level ${level}: [${depthNodes[0].data.label}] -> ID: ${depthNodes[0].id} @ (${depthNodes[0].position.x}, ${depthNodes[0].position.y})`);
          currentNodeId = depthNodes[0].id;
        } else {
          break;
        }
      }
    }

  } catch (err: any) {
    console.error('Test threw an error:', err.message || err);
  }
}

testGeneration();
