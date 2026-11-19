import json, math, sys
import numpy as np
import scipy
from scipy.stats import binom

n, p, low, high = 200, 0.00001, 100, 100000
result = {
    'python': sys.version.split()[0], 'numpy': np.__version__, 'scipy': scipy.__version__,
    'CLT_counterexample': {
        'n': n, 'probability_high_order': p, 'amounts': [low, high],
        'population_mean': low+(high-low)*p,
        'population_variance': (high-low)**2*p*(1-p),
        'probability_sample_mean_equals_100': float(binom.pmf(0,n,p)),
        'sample_mean_skewness': (1-2*p)/math.sqrt(n*p*(1-p)),
    },
    'metrics_examples': {
        'IoU': 30/60, 'IoU_wrong_30_div_120': 30/120,
        'CV_A': 5/100, 'CV_B': 1/10,
        'gray_28x28':28*28, 'gray_double':2*28*28,
        'errors_1_3_MAE':float(np.mean(np.abs([1,3]))),
        'errors_1_3_RMSE':float(np.sqrt(np.mean(np.square([1,3])))),
    },
    'RAG_context_counterexample': {'pages':50,'tokens_per_page':500,'document_tokens':25000,'question_and_answer_budget':3000,'context_capacity':128000,'fits':25000+3000<=128000},
    'inference_scope_counterexample': {'training_rows':100000,'training_epochs':20,'training_row_passes':2000000,'lifetime_inference_requests':100000000},
}
print(json.dumps(result,ensure_ascii=False,indent=2))
