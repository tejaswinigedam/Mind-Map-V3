import { GeminiService } from './services/GeminiService';

async function testValidation() {
  console.log('=== Starting Topic Validation Agent Offline Fallback & Service Tests ===\n');

  const testCases = [
    { input: 'skincare', expectedStatus: 'clear' },
    { input: 'machine learning', expectedStatus: 'clear' },
    { input: 'gets tired', expectedStatus: 'ambiguous' },
    { input: 'stress', expectedStatus: 'ambiguous' },
    { input: 'diet', expectedStatus: 'ambiguous' },
    { input: 'xyz', expectedStatus: 'invalid' },
    { input: 'abc', expectedStatus: 'invalid' },
    { input: 'hello', expectedStatus: 'invalid' },
  ];

  let successCount = 0;

  for (const tc of testCases) {
    try {
      console.log(`Testing Input: "${tc.input}"`);
      const result = await GeminiService.validateTopic(tc.input);
      console.log(`-> Status: ${result.status.toUpperCase()}`);
      console.log(`-> Message: ${result.message.replace(/\n/g, ' ')}`);
      if (result.options) {
        console.log(`-> Options: ${JSON.stringify(result.options)}`);
      }

      if (result.status === tc.expectedStatus) {
        console.log('✅ PASS\n');
        successCount++;
      } else {
        console.error(`❌ FAIL: Expected ${tc.expectedStatus.toUpperCase()} but got ${result.status.toUpperCase()}\n`);
      }
    } catch (error: any) {
      console.error(`❌ ERROR: Test threw exception: ${error.message || error}\n`);
    }
  }

  console.log(`=== Tests Complete: ${successCount}/${testCases.length} passed ===`);
  if (successCount === testCases.length) {
    console.log('🎉 ALL TESTS PASSED!');
  } else {
    process.exit(1);
  }
}

testValidation();
