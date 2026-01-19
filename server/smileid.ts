import SmileID from 'smile-identity-core';

if (!process.env.SMILE_ID_PARTNER_ID || !process.env.SMILE_ID_API_KEY) {
  console.warn("SMILE_ID_PARTNER_ID or SMILE_ID_API_KEY is missing. Smile ID integration will not work.");
}

const partner_id = process.env.SMILE_ID_PARTNER_ID || "";
const api_key = process.env.SMILE_ID_API_KEY || "";
const sid_server = process.env.NODE_ENV === 'production' ? 1 : 0; // 0 for sandbox, 1 for production

// The WebApi constructor expects (partner_id, api_key, sid_server, callback_url)
export const smileID = new SmileID.WebApi(
  partner_id,
  api_key,
  sid_server.toString(),
  "" // No callback URL for synchronous response
);

export async function submitSmileIDJob(userId: string, jobType: number, images: any[]) {
  const job_id = `job_${userId}_${Date.now()}`;

  const partner_params = {
    job_id: job_id,
    user_id: userId,
    job_type: jobType,
  };

  const options = {
    return_job_status: true,
    return_history: true,
    return_image_links: true,
  };

  try {
    const response = await smileID.submit_job(partner_params, images, {}, options);
    return response as any;
  } catch (error) {
    console.error("Smile ID Job Submission Error:", error);
    throw error;
  }
}
