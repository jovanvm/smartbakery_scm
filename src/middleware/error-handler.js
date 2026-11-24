export class HttpError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function notFoundHandler(_request, response) {
  response.status(404).json({
    status: 'error',
    message: 'Endpoint API tidak ditemukan.'
  });
}

export function errorHandler(error, _request, response, next) {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    const payload = {
      status: 'error',
      message: error.message
    };

    if (error.details) {
      payload.details = error.details;
    }

    response.status(error.statusCode).json(payload);
    return;
  }

  if (error?.type === 'entity.parse.failed') {
    response.status(400).json({
      status: 'error',
      message: 'Body JSON tidak valid.'
    });
    return;
  }

  if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    response.status(409).json({
      status: 'error',
      message: 'Data dengan kode atau nomor yang sama sudah ada.'
    });
    return;
  }

  if (error?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    response.status(400).json({
      status: 'error',
      message: 'Referensi data tidak valid.'
    });
    return;
  }

  if (error?.code === 'SQLITE_CONSTRAINT_CHECK') {
    response.status(400).json({
      status: 'error',
      message: 'Nilai tidak memenuhi aturan data.'
    });
    return;
  }

  console.error('[api]', error);
  response.status(500).json({
    status: 'error',
    message: 'Terjadi kesalahan pada server.'
  });
}
