import { NextResponse } from 'next/server';
import { ImageAnnotatorClient } from '@google-cloud/vision';

export async function POST(request: Request) {
  const data = await request.formData();
  const file: File | null = data.get('file') as unknown as File;

  if (!file) {
    return NextResponse.json({ success: false, error: 'No file found' });
  }

  const bytes = await file.arrayBuffer();
  const image = Buffer.from(bytes).toString('base64');

  const client = new ImageAnnotatorClient();

  try {
    if (typeof client.objectLocalization !== 'function') {
      throw new Error('objectLocalization function does not exist on client');
    }
    const [result] = await (client.objectLocalization as Function)({
      image: { content: image },
    });

    const objects = result.localizedObjectAnnotations;
    if (!objects) {
      return NextResponse.json({ success: false, error: 'No objects found' });
    }
    return NextResponse.json({ success: true, objects });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ success: false, error: 'An error occurred while processing the image.' });
  }
}
